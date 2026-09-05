// Server-only pipeline for pticha/sgira request emails relayed from Gmail.
// Everything here is idempotent per gmail_message_id and refuses to perform any
// operational write while the automation is in `off` or `dry_run` mode.
//
// Response contract with the Apps Script relay:
//   { ok: true,  completed: true,  ... }  → safe to mark the mail as read
//   { ok: true,  completed: false, ... }  → still in progress, do NOT mark read
//   { ok: false, retry: true|false }      → failure, do NOT mark read, keep cursor
import { evaluateRules, parseRequestEmail, systemCodeMatchKey, type RequestRule, type RequestType } from "@/lib/system-code";

export type AutomationMode = "off" | "dry_run" | "live";

export type IngestPayload = {
  gmailMessageId: string;
  gmailThreadId?: string | null;
  subject?: string | null;
  body?: string | null;
  receivedAt?: string | null;
  attachmentName?: string | null;
  attachmentIndex?: number | null;
  /** Request type derived from the Gmail label the message was found under. */
  sourceRequestType?: string | null;
  sourceLabel?: string | null;
};

// Settings/rule reads throw on a DB error on purpose: a technical failure must
// surface as failed+retry, never be mistaken for "no setting" / "no rule",
// which would silently turn into a wrong decision.
export async function readAutomationMode(supabaseAdmin: any): Promise<AutomationMode> {
  const { data, error } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "request_automation_mode").maybeSingle();
  if (error) throw new Error(`קריאת מצב האוטומציה נכשלה: ${error.message}`);
  const mode = (data?.value as { mode?: string } | null)?.mode;
  return mode === "live" || mode === "off" ? mode : "dry_run";
}

async function readDefaultStatus(supabaseAdmin: any, type: RequestType): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", `request_default_status_${type}`).maybeSingle();
  if (error) throw new Error(`קריאת סטטוס ברירת המחדל נכשלה: ${error.message}`);
  const status = (data?.value as { status?: string | null } | null)?.status;
  return status && String(status).trim() ? String(status).trim() : null;
}

async function readRules(supabaseAdmin: any, crmKey: string): Promise<RequestRule[]> {
  const { data, error } = await supabaseAdmin
    .from("system_request_rules")
    .select("id, crm_key, request_type, from_status, action, to_status, is_active, sort_order")
    .eq("crm_key", crmKey)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`קריאת כללי האוטומציה נכשלה: ${error.message}`);
  return (data ?? []) as RequestRule[];
}

/**
 * All systems whose code matches, parents and sub-systems alike. Matching runs
 * in Postgres through `find_systems_by_code_key`, using the shared match key
 * (digits, leading zeros stripped) so a code stored as `0882309477` still
 * matches the `882309477` the email carries.
 */
export async function findSystemsByNormalizedCode(supabaseAdmin: any, codeNorm: string) {
  const key = systemCodeMatchKey(codeNorm);
  if (!key) return [];
  const { data, error } = await supabaseAdmin.rpc("find_systems_by_code_key", { _key: key });
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

/**
 * Every state write goes through here. A failed UPDATE must never be silently
 * swallowed: if the row did not move, the relay may not treat the message as
 * completed, so the error is thrown and the caller marks the request failed.
 */
async function finish(supabaseAdmin: any, id: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("system_requests").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

function done(supabaseAdmin: any, id: string, patch: Record<string, unknown>) {
  return finish(supabaseAdmin, id, { processing_state: "done", ...patch });
}

/** A technical RPC failure — distinct from a business "false" answer. */
class RequestPipelineError extends Error {}


/** Normalizes the request type sent by the relay label into our enum. */
export function normalizeSourceRequestType(value: unknown): RequestType | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "pticha" || v === "ptixa" || v.includes("פתיח")) return "pticha";
  if (v === "sgira" || v === "sgirah" || v.includes("סגיר") || v.includes("חסימ")) return "sgira";
  return null;
}

/**
 * The business logic a status change must trigger regardless of who made it:
 * status-based auto-assignment and the automatic voice message. Applied here
 * so a change coming from the email automation behaves like a manual one.
 * (History/audit rows are written by the DB trigger on `systems`.)
 *
 * Every step is individually idempotent, so a crash right before the
 * `side_effects_completed_at` stamp cannot cause a double assignment or a
 * duplicate voice message on the next retry.
 */
export async function applyStatusSideEffects(
  supabaseAdmin: any,
  systemId: string,
  toStatus: string,
  requestId?: string | null,
) {
  // The assignment is part of the work this request must finish. A failure here
  // propagates, so `side_effects_completed_at` below is never stamped on a
  // half-done request and the next retry picks the assignment up again.
  const { resolveAutoAssign, applyAutoStatusAssignment } = await import("@/lib/auto-assign.server");
  const auto = await resolveAutoAssign(supabaseAdmin, toStatus);
  if (auto) {
    // Idempotent by construction: the RPC only updates when the agent differs,
    // and it marks the change as automatic in the same transaction so it stays
    // out of the visible history (the status change itself remains visible).
    await applyAutoStatusAssignment(supabaseAdmin, systemId, auto.agentId, auto.otherAgentIds);
  }


  // The voice helper deduplicates against `voice_message_log` and the debounce
  // window, so calling it again after a crash does not resend.
  const { maybeScheduleOrSendAutoVoice } = await import("@/lib/systems.functions");
  await maybeScheduleOrSendAutoVoice(supabaseAdmin, systemId, toStatus);

  if (requestId) {
    await finish(supabaseAdmin, requestId, { side_effects_completed_at: new Date().toISOString() });
  }
}

export async function ingestSystemRequest(supabaseAdmin: any, payload: IngestPayload, crmKey = "yemot") {
  const messageId = String(payload.gmailMessageId || "").trim();
  if (!messageId) return { ok: false, completed: false, retry: false, error: "gmailMessageId required" };

  // Concurrency guard: a second simultaneous delivery of the same message
  // backs off instead of racing the first one. It is explicitly NOT a success:
  // the relay must not mark the mail as read on this answer.
  // A failure of the guard itself is a technical failure: ingesting without the
  // lock is not allowed, so the relay is asked to retry.
  const { data: hits, error: lockError } = await supabaseAdmin.rpc("bump_rate_limit", {
    _key: `req:${messageId}`,
    _window_seconds: 60,
  });
  if (lockError) {
    return { ok: false, completed: false, retry: true, error: `נעילת הקליטה נכשלה: ${lockError.message}` };
  }
  if (Number(hits ?? 0) > 1) {
    return { ok: false, completed: false, retry: true, processingState: "in_progress", reason: "in_progress" };
  }

  const receivedIso = payload.receivedAt ?? new Date().toISOString();
  const parsed = parseRequestEmail({ subject: payload.subject, body: payload.body });
  const labelType = normalizeSourceRequestType(payload.sourceRequestType ?? payload.sourceLabel);
  // The Gmail label is the primary signal; the body is used only to confirm it
  // or, when there is no label, on its own. No silent "pticha" default: an
  // unidentified type is stored as NULL and always needs a human decision.
  const typeConflict = Boolean(labelType && parsed.requestType && labelType !== parsed.requestType);
  let requestType: RequestType | null = labelType ?? parsed.requestType;

  // ---- gate: a valid request MUST carry a system code ----------------------
  // A labelled Gmail thread is scanned message by message, so replies and
  // follow-ups inside the same thread arrive here as separate messages with
  // their own gmail_message_id. Without this gate each of them created an
  // empty, unassigned request row. A system code is never borrowed from
  // another message in the thread — the message is simply not a request.
  // `completed: true` so the relay marks it read and stops re-posting it.
  if (!parsed.systemCodeNorm) {
    return {
      ok: true, completed: true, skipped: true,
      reason: "no_system_code",
      message: "ההודעה אינה בקשת מערכת — לא נמצא בה מספר מערכת",
    };
  }

  // The mode is read before the row is written so the request permanently
  // records the automation mode that was in effect when it arrived.
  let mode: AutomationMode;
  try {
    mode = await readAutomationMode(supabaseAdmin);
  } catch (e: any) {
    return { ok: false, completed: false, retry: true, error: String(e?.message ?? e) };
  }

  const insertRow = {
    crm_key: crmKey,
    gmail_message_id: messageId,
    gmail_thread_id: payload.gmailThreadId ?? null,
    request_type: requestType,
    source_request_type: labelType,
    request_number: parsed.requestNumber,
    system_code_raw: parsed.systemCodeRaw,
    system_code_norm: parsed.systemCodeNorm,
    caller_phone: parsed.callerPhone,
    caller_phone_norm: parsed.callerPhoneNorm,
    subject: payload.subject ?? null,
    attachment_name: payload.attachmentName ?? null,
    attachment_index: typeof payload.attachmentIndex === "number" ? payload.attachmentIndex : null,
    received_at: receivedIso,
    processing_state: "received",
    automation_mode: mode,
  };

  const { error: insertError } = await supabaseAdmin.from("system_requests").insert(insertRow);
  if (insertError) {
    const text = `${(insertError as any).code ?? ""} ${insertError.message ?? ""}`;
    // Same request number, type and system code as a live request → this is the
    // same request arriving twice (a resend inside the thread), not a new one.
    // The DB unique index is the arbiter, so two concurrent deliveries cannot
    // both win. The row is still recorded, flagged and linked to the original.
    if (text.includes("system_requests_dedupe_uniq")) {
      const { data: original } = await supabaseAdmin
        .from("system_requests").select("id")
        .eq("crm_key", crmKey)
        .eq("request_type", requestType)
        .eq("system_code_norm", parsed.systemCodeNorm)
        .eq("request_number", parsed.requestNumber)
        .is("duplicate_of", null)
        .maybeSingle();
      await supabaseAdmin.from("system_requests").insert({
        ...insertRow,
        duplicate_of: (original as any)?.id ?? null,
        processing_state: "done",
        last_completed_state: "parsed",
        decision_status: "duplicate",
        dry_run: false,
        last_error: "כפילות — אותה בקשה כבר נקלטה",
      }).then(() => {}, () => {});
    } else if (!text.includes("system_requests_gmail_message_id_key") && !text.includes("23505")) {
      return { ok: false, completed: false, retry: true, error: `שמירת הבקשה נכשלה: ${insertError.message}` };
    }
  }

  const { data: row, error: readError } = await supabaseAdmin
    .from("system_requests").select("*").eq("gmail_message_id", messageId).maybeSingle();
  if (readError) {
    return { ok: false, completed: false, retry: true, error: `קריאת הבקשה נכשלה: ${readError.message}` };
  }
  if (!row) return { ok: false, completed: false, retry: true, error: "could not persist request" };
  const req = row as any;
  if (req.processing_state === "done") {
    return { ok: true, completed: true, duplicate: true, requestId: req.id, decision: req.decision_status };
  }

  if (mode === "off") {
    // The automation was OFF: the request is recorded for a human, nothing is
    // computed and nothing is simulated. `dry_run` stays false — this was not
    // a test run, and the stored `automation_mode` says so.
    await done(supabaseAdmin, req.id, {
      last_completed_state: "parsed",
      decision_status: "needs_decision", dry_run: false,
    });
    return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
  }
  const dryRun = mode !== "live";


  try {
    // ---- resume: the status was already applied on an earlier attempt ----
    // Never re-run matching or the rule engine in that case — only finish the
    // side effects that may still be missing.
    if (req.status_applied_at && req.system_id && req.new_status) {
      if (!req.side_effects_completed_at) {
        await applyStatusSideEffects(supabaseAdmin, req.system_id, req.new_status, req.id);
      }
      await done(supabaseAdmin, req.id, {
        decision_status: req.decision_status ?? "auto_applied",
      });
      return { ok: true, completed: true, requestId: req.id, mode, decision: req.decision_status ?? "auto_applied", resumed: true };
    }

    let system: { id: string; status?: string | null } | null = null;
    let currentStatus = "";
    let outcome: { action: string; toStatus: string | null; rule?: { id: string } | null };
    let callerPhone = parsed.callerPhone;

    // ---- resume: matching and the rule engine already completed ----
    // `matched` means the proposal stored on the row is authoritative. Running
    // the rules again would re-evaluate against a status that may have moved,
    // so the stored decision is reused verbatim.
    const resumedFromMatch = req.last_completed_state === "matched" && Boolean(req.system_id);
    if (resumedFromMatch) {
      system = { id: req.system_id as string };
      currentStatus = String(req.prev_status ?? "");
      outcome = {
        action: String(req.proposed_action ?? "needs_decision"),
        toStatus: (req.proposed_status as string | null) ?? null,
        rule: req.rule_id ? { id: req.rule_id as string } : null,
      };
      if (!requestType) requestType = (req.request_type as RequestType | null) ?? null;
    } else {
      // ---- parse ----
      if (typeConflict) {
        await done(supabaseAdmin, req.id, {
          last_completed_state: "parsed",
          decision_status: "needs_decision", dry_run: dryRun,
          last_error: `סתירה בין תגית הגמייל (${labelType}) לתוכן המייל (${parsed.requestType})`,
        });
        return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
      }
      if (!requestType || !parsed.systemCodeNorm) {
        await done(supabaseAdmin, req.id, {
          last_completed_state: "parsed",
          decision_status: "needs_decision", dry_run: dryRun,
          last_error: !requestType ? "לא זוהה סוג הבקשה" : "לא זוהה מספר מערכת",
        });
        return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
      }

      // ---- match ----
      const matches = await findSystemsByNormalizedCode(supabaseAdmin, parsed.systemCodeNorm);
      if (matches.length > 1) {
        await done(supabaseAdmin, req.id, {
          last_completed_state: "parsed",
          decision_status: "needs_decision", dry_run: dryRun,
          last_error: "נמצאה יותר ממערכת אחת עם מספר זה",
        });
        return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
      }
      system = matches.length === 1 ? (matches[0] as any) : null;

      // ---- no such system: this is the "create" path, not the rules path ----
      if (!system) {
        const defaultStatus = await readDefaultStatus(supabaseAdmin, requestType);
        if (!defaultStatus) {
          await done(supabaseAdmin, req.id, {
            last_completed_state: "parsed",
            decision_status: "needs_decision", dry_run: dryRun,
            last_error: "לא הוגדר סטטוס ברירת מחדל ליצירת מערכת חדשה",
          });
          return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
        }
        if (dryRun) {
          // DRY RUN: nothing is created. The automation knew exactly what it
          // would have done, so this is a simulation — not a pending decision.
          await done(supabaseAdmin, req.id, {
            last_completed_state: "parsed",
            decision_status: "simulated", dry_run: true,
            proposed_action: "create_system",
            proposed_status: defaultStatus,
            last_error: "הרצת בדיקה — מערכת חדשה לא נוצרה",
          });
          return { ok: true, completed: true, requestId: req.id, mode, decision: "simulated", wouldCreate: true };
        }

        // LIVE: create once, in the configured default status. A brand-new
        // system deliberately does NOT go through the rule engine — the rules
        // describe transitions between existing statuses, and the creation
        // status is already the intended result of this request.
        const { data: created, error: createError } = await supabaseAdmin.from("systems").insert({
          system_code: parsed.systemCodeRaw ?? parsed.systemCodeNorm,
          name: `מערכת ${parsed.systemCodeNorm}`,
          name_pending: true,
          status: defaultStatus,
          caller_phone: parsed.callerPhone,
          source: "מייל אוטומטי",
        }).select("id, status").maybeSingle();

        let newSystem = created as any;
        if (!newSystem) {
          // A unique-code conflict means a concurrent attempt already created
          // it; re-reading keeps the operation idempotent.
          const again = await findSystemsByNormalizedCode(supabaseAdmin, parsed.systemCodeNorm);
          newSystem = again.length === 1 ? again[0] : null;
        }
        if (!newSystem) throw new Error(`יצירת המערכת נכשלה${createError?.message ? `: ${createError.message}` : ""}`);

        await finish(supabaseAdmin, req.id, {
          processing_state: "matched",
          last_completed_state: "matched",
          request_type: requestType,
          system_id: newSystem.id,
          prev_status: null,
          proposed_action: "create_system",
          proposed_status: defaultStatus,
          new_status: defaultStatus,
          status_applied_at: new Date().toISOString(),
          dry_run: false,
        });
        // The phone came in with the insert, so only the status side effects
        // remain. They are idempotent and stamp the request when finished.
        await applyStatusSideEffects(supabaseAdmin, newSystem.id, defaultStatus, req.id);
        await done(supabaseAdmin, req.id, { decision_status: "auto_applied" });
        return { ok: true, completed: true, requestId: req.id, mode, decision: "auto_applied", created: true, newStatus: defaultStatus };
      }

      currentStatus = String((system as any).status ?? "");
      const rules = await readRules(supabaseAdmin, crmKey);
      outcome = evaluateRules(rules, requestType, currentStatus);

      await finish(supabaseAdmin, req.id, {
        processing_state: "matched",
        last_completed_state: "matched",
        request_type: requestType,
        system_id: system.id,
        prev_status: currentStatus,
        rule_id: outcome.rule?.id ?? null,
        proposed_action: outcome.action,
        proposed_status: outcome.toStatus,
        dry_run: dryRun,
      });
    }

    if (dryRun) {
      // DRY RUN stops here: no phone added, no status changed, no side effects.
      // When the engine reached a clear conclusion the request is a simulation,
      // not a pending decision — only a genuinely unresolved case joins the
      // "needs decision" queue.
      const unresolved = outcome.action === "needs_decision" || (outcome.action === "set_status" && !outcome.toStatus);
      const decision = unresolved ? "needs_decision" : "simulated";
      await done(supabaseAdmin, req.id, { decision_status: decision });
      return { ok: true, completed: true, requestId: req.id, mode, decision, proposed: outcome.action };
    }

    // ---- decision first, actions after -------------------------------------
    // The decision determines which operational writes are allowed at all:
    //   ignore         → nothing at all (no status, no phone, no assignment)
    //   needs_decision → nothing until a human decides
    //   keep           → status untouched, but the caller phone is added
    //   set_status     → status changed + phone + the status side effects
    if (outcome.action === "ignore") {
      await done(supabaseAdmin, req.id, { decision_status: "ignored" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "ignored" };
    }
    if (outcome.action === "needs_decision" || (outcome.action === "set_status" && !outcome.toStatus)) {
      await done(supabaseAdmin, req.id, { decision_status: "needs_decision" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
    }

    // From here on the request is "handled", so the caller phone may be stored.
    // Atomic: the RPC locks, dedupes and stamps in one transaction, so a retry
    // can never add the same number twice.
    await addCallerPhone(supabaseAdmin, req, system.id, callerPhone);

    if (outcome.action === "keep" || outcome.toStatus === currentStatus) {
      await done(supabaseAdmin, req.id, {
        decision_status: "kept",
        last_error: null,
      });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "kept" };
    }


    const { data: applied, error: applyError } = await supabaseAdmin.rpc("apply_request_status_change", {
      _request_id: req.id,
      _system_id: system.id,
      _from_status: currentStatus,
      _to_status: outcome.toStatus,
      _reason: `בקשת ${requestType === "pticha" ? "פתיחה" : "סגירה"} אוטומטית מהמייל`,
    });
    // Technical error → retry. `false` is not an error: it means the compare
    // and-swap lost because the status moved meanwhile, which is a human call.
    if (applyError) throw new RequestPipelineError(`עדכון הסטטוס נכשל: ${applyError.message}`);
    if (applied === true) {
      await applyStatusSideEffects(supabaseAdmin, system.id, outcome.toStatus, req.id);
      await done(supabaseAdmin, req.id, { decision_status: "auto_applied" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "auto_applied", newStatus: outcome.toStatus };
    }
    await done(supabaseAdmin, req.id, {
      decision_status: "needs_decision",
      last_error: "הסטטוס השתנה בינתיים — נדרשת החלטה ידנית",
    });
    return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };

  } catch (e: any) {
    // Recording the failure may itself fail (that is often the original cause).
    // Either way the caller must be told to retry and NOT to mark the mail read.
    try {
      await finish(supabaseAdmin, req.id, {
        processing_state: "failed",
        attempts: Number(req.attempts ?? 0) + 1,
        last_error: String(e?.message ?? e).slice(0, 500),
        error_at: new Date().toISOString(),
      });
    } catch { /* the state write is unavailable; the retry path still holds */ }
    return { ok: false, completed: false, retry: true, requestId: req.id, error: String(e?.message ?? e) };
  }

}
