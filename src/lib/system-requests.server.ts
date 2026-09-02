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

export async function readAutomationMode(supabaseAdmin: any): Promise<AutomationMode> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "request_automation_mode").maybeSingle();
  const mode = (data?.value as { mode?: string } | null)?.mode;
  return mode === "live" || mode === "off" ? mode : "dry_run";
}

async function readDefaultStatus(supabaseAdmin: any, type: RequestType): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", `request_default_status_${type}`).maybeSingle();
  const status = (data?.value as { status?: string | null } | null)?.status;
  return status && String(status).trim() ? String(status).trim() : null;
}

async function readRules(supabaseAdmin: any, crmKey: string): Promise<RequestRule[]> {
  const { data } = await supabaseAdmin
    .from("system_request_rules")
    .select("id, crm_key, request_type, from_status, action, to_status, is_active, sort_order")
    .eq("crm_key", crmKey)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
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
  try {
    const { data: hits } = await supabaseAdmin.rpc("bump_rate_limit", {
      _key: `req:${messageId}`,
      _window_seconds: 60,
    });
    if (Number(hits ?? 0) > 1) {
      return { ok: false, completed: false, retry: true, processingState: "in_progress", reason: "in_progress" };
    }
  } catch {
    // Lock is best-effort; the unique key below still prevents duplicates.
  }

  const receivedIso = payload.receivedAt ?? new Date().toISOString();
  const parsed = parseRequestEmail({ subject: payload.subject, body: payload.body });
  const labelType = normalizeSourceRequestType(payload.sourceRequestType ?? payload.sourceLabel);
  // The Gmail label is the primary signal; the body is used only to confirm it
  // or, when there is no label, on its own. No silent "pticha" default.
  const typeConflict = Boolean(labelType && parsed.requestType && labelType !== parsed.requestType);
  const requestType: RequestType | null = labelType ?? parsed.requestType;

  const insertRow = {
    crm_key: crmKey,
    gmail_message_id: messageId,
    gmail_thread_id: payload.gmailThreadId ?? null,
    request_type: requestType ?? "pticha",
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
  };

  await supabaseAdmin.from("system_requests").insert(insertRow).then(() => {}, () => {});
  const { data: row } = await supabaseAdmin
    .from("system_requests").select("*").eq("gmail_message_id", messageId).maybeSingle();
  if (!row) return { ok: false, completed: false, retry: true, error: "could not persist request" };
  const req = row as any;
  if (req.processing_state === "done") {
    return { ok: true, completed: true, duplicate: true, requestId: req.id, decision: req.decision_status };
  }

  const mode = await readAutomationMode(supabaseAdmin);
  if (mode === "off") {
    await done(supabaseAdmin, req.id, {
      last_completed_state: "parsed",
      decision_status: "needs_decision", dry_run: true,
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
    let system = matches.length === 1 ? matches[0] : null;

    if (matches.length > 1) {
      await done(supabaseAdmin, req.id, {
        last_completed_state: "parsed",
        decision_status: "needs_decision", dry_run: dryRun,
        last_error: "נמצאה יותר ממערכת אחת עם מספר זה",
      });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
    }

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
        // DRY RUN: nothing is created. Only the proposal is recorded.
        await done(supabaseAdmin, req.id, {
          last_completed_state: "parsed",
          decision_status: "needs_decision", dry_run: true,
          proposed_action: "create_system",
          proposed_status: defaultStatus,
          last_error: "הרצת בדיקה — מערכת חדשה לא נוצרה",
        });
        return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision", wouldCreate: true };
      }
      const { data: created } = await supabaseAdmin.from("systems").insert({
        system_code: parsed.systemCodeRaw ?? parsed.systemCodeNorm,
        name: `מערכת ${parsed.systemCodeNorm}`,
        name_pending: true,
        status: defaultStatus,
        caller_phone: parsed.callerPhone,
        source: "מייל אוטומטי",
      }).select("id, status, caller_phone, phone, additional_caller_phones").maybeSingle();
      if (created) {
        system = created as any;
      } else {
        const again = await findSystemsByNormalizedCode(supabaseAdmin, parsed.systemCodeNorm);
        system = again.length === 1 ? again[0] : null;
      }
      if (!system) throw new Error("יצירת המערכת נכשלה");
    }

    const currentStatus = String(system.status ?? "");
    const rules = await readRules(supabaseAdmin, crmKey);
    const outcome = evaluateRules(rules, requestType, currentStatus);

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

    if (dryRun) {
      // DRY RUN stops here: no phone added, no status changed, no side effects.
      await done(supabaseAdmin, req.id, { decision_status: "needs_decision" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision", proposed: outcome.action };
    }

    // ---- caller phone (atomic: lock, dedupe and stamp in one transaction) ----
    if (parsed.callerPhone && !req.phone_added_at) {
      await supabaseAdmin.rpc("add_request_caller_phone", {
        _request_id: req.id,
        _system_id: system.id,
        _phone: parsed.callerPhone,
      });
    }

    // ---- decision ----
    if (outcome.action === "ignore") {
      await done(supabaseAdmin, req.id, { decision_status: "ignored" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "ignored" };
    }
    if (outcome.action === "keep") {
      await done(supabaseAdmin, req.id, { decision_status: "kept" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "kept" };
    }
    if (outcome.action === "needs_decision" || !outcome.toStatus) {
      await done(supabaseAdmin, req.id, { decision_status: "needs_decision" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "needs_decision" };
    }

    if (outcome.toStatus === currentStatus) {
      await done(supabaseAdmin, req.id, { decision_status: "kept" });
      return { ok: true, completed: true, requestId: req.id, mode, decision: "kept" };
    }

    const { data: applied } = await supabaseAdmin.rpc("apply_request_status_change", {
      _request_id: req.id,
      _system_id: system.id,
      _from_status: currentStatus,
      _to_status: outcome.toStatus,
      _reason: `בקשת ${requestType === "pticha" ? "פתיחה" : "סגירה"} אוטומטית מהמייל`,
    });
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
    await finish(supabaseAdmin, req.id, {
      processing_state: "failed",
      attempts: Number(req.attempts ?? 0) + 1,
      last_error: String(e?.message ?? e).slice(0, 500),
      error_at: new Date().toISOString(),
    });
    return { ok: false, completed: false, retry: true, requestId: req.id, error: String(e?.message ?? e) };
  }
}
