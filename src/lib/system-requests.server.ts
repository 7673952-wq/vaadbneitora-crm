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
  /** "תאור הדיווח" as extracted by the relay from THIS message. */
  reportDescription?: string | null;
  /** Request type derived from the Gmail label the message was found under. */
  sourceRequestType?: string | null;
  sourceLabel?: string | null;
};

/** Settings are stored per CRM; the original CRM keeps the historical keys. */
export function requestSettingKey(base: string, crmKey: string) {
  return crmKey === "yemot" ? base : `${base}__${crmKey}`;
}

// Settings/rule reads throw on a DB error on purpose: a technical failure must
// surface as failed+retry, never be mistaken for "no setting" / "no rule",
// which would silently turn into a wrong decision.
export async function readAutomationMode(supabaseAdmin: any, crmKey = "yemot"): Promise<AutomationMode> {
  const { data, error } = await supabaseAdmin
    .from("app_settings").select("value")
    .eq("key", requestSettingKey("request_automation_mode", crmKey)).maybeSingle();
  if (error) throw new Error(`קריאת מצב האוטומציה נכשלה: ${error.message}`);
  const mode = (data?.value as { mode?: string } | null)?.mode;
  return mode === "live" || mode === "off" ? mode : "dry_run";
}

async function readDefaultStatus(supabaseAdmin: any, type: RequestType, crmKey = "yemot"): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("app_settings").select("value")
    .eq("key", requestSettingKey(`request_default_status_${type}`, crmKey)).maybeSingle();
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

/** Decision rows that may still be acted upon. */
export const OPEN_DECISIONS = ["needs_decision", "simulated"];

export type ManualAction = "apply" | "keep" | "ignore" | "create_system";

export type ManualDecisionPlan =
  | { mode: "conflict"; startedAction: string }
  | {
      mode: "start" | "resume";
      /** Status this decision committed to; a resume never re-reads intent. */
      targetStatus: string | null;
      /** Name chosen for a system created by this decision (create_system). */
      targetName: string | null;
      /** The status change of THIS decision already went through. */
      statusAlreadyApplied: boolean;
      /** Side effects already ran once; they must not run again. */
      sideEffectsDone: boolean;
      /** A system was already created/linked by this same decision. */
      systemAlreadyLinked: boolean;
    };

/** An empty string is never a business value — it is stored as NULL. */
export function normalizeIntentValue(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

/**
 * Decides how a manual decision proceeds, from the DURABLE intent stored on
 * the request — never from the current state of the system card.
 *
 * That distinction is the whole point: after a partial `apply` the system
 * status already equals the target, and re-deriving the decision from state
 * would silently downgrade it to "kept". A retry resumes the same action, and
 * a different action is refused.
 *
 * The chosen system NAME is part of that intent too, so a crash between the
 * intent write and the INSERT cannot make the retry create a card with a
 * different (placeholder) name than the one the user typed.
 */
export function planManualDecision(
  req: {
    manual_action?: string | null;
    manual_target_status?: string | null;
    manual_target_name?: string | null;
    status_applied_at?: string | null;
    side_effects_completed_at?: string | null;
    system_id?: string | null;
    proposed_status?: string | null;
  },
  action: ManualAction,
  requestedStatus?: string | null,
  requestedName?: string | null,
): ManualDecisionPlan {
  const started = String(req.manual_action ?? "").trim();
  if (started && started !== action) return { mode: "conflict", startedAction: started };
  const resuming = Boolean(started);
  const target = resuming
    ? normalizeIntentValue(req.manual_target_status)
    : (normalizeIntentValue(requestedStatus) ?? normalizeIntentValue(req.proposed_status));
  const name = resuming
    ? normalizeIntentValue(req.manual_target_name)
    : normalizeIntentValue(requestedName);
  return {
    mode: resuming ? "resume" : "start",
    targetStatus: target,
    targetName: name,
    statusAlreadyApplied: resuming && Boolean(req.status_applied_at),
    sideEffectsDone: Boolean(req.side_effects_completed_at),
    systemAlreadyLinked: resuming && Boolean(req.system_id),
  };
}


export type LinkExistingResult =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "conflict" }
  | { kind: "linked"; systemId: string; status: string | null };

/**
 * Attaches an unlinked request to the system that already carries its code.
 * The link itself is never a decision: no status change, no caller phone —
 * the request stays open so the user chooses what to do with it.
 * Exactly one match links; several matches stay unlinked and ask for a human.
 *
 * Both writes are compare-and-swap and must PROVE a row moved. A conditional
 * update that matched nothing returns `conflict` — never "linked" — so a lost
 * race can never be counted or reported as a success.
 */
export async function linkRequestToExistingSystem(
  supabaseAdmin: any, requestId: string, codeNorm: string,
): Promise<LinkExistingResult> {
  const matches = await findSystemsByNormalizedCode(supabaseAdmin, codeNorm);
  if (matches.length === 0) return { kind: "none" };

  if (matches.length > 1) {
    const { data: rows, error } = await supabaseAdmin.from("system_requests").update({
      decision_status: "needs_decision",
      last_error: "נמצאה יותר ממערכת אחת עם מספר זה — יש לשייך ידנית",
    }).eq("id", requestId).in("decision_status", OPEN_DECISIONS).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) return { kind: "conflict" };
    return { kind: "ambiguous" };
  }

  const match = matches[0] as any;
  // CAS: only an open, still-unlinked request may be attached, so two parallel
  // actions cannot link the same request twice.
  const { data: rows, error } = await supabaseAdmin.from("system_requests").update({
    system_id: match.id,
    prev_status: match.status ?? null,
    last_completed_state: "matched",
    last_error: null,
  }).eq("id", requestId).is("system_id", null).in("decision_status", OPEN_DECISIONS).select("id");
  if (error) throw new Error(error.message);
  if (!rows?.length) return { kind: "conflict" };
  return { kind: "linked", systemId: match.id, status: match.status ?? null };
}


/**
 * One-off repair for rows ingested before the link step existed: an open
 * request with no system, whose code does exist in `systems` today.
 */
export async function relinkOpenRequests(supabaseAdmin: any, crmKey = "yemot") {
  const { data, error } = await supabaseAdmin
    .from("system_requests")
    .select("id, system_code_norm")
    .eq("crm_key", crmKey)
    .is("system_id", null)
    .in("decision_status", OPEN_DECISIONS)
    .limit(500);
  if (error) throw new Error(error.message);

  let linked = 0, ambiguous = 0, missing = 0, conflicts = 0;
  for (const row of (data ?? []) as any[]) {
    const codeNorm = String(row.system_code_norm ?? "").trim();
    if (!codeNorm) { missing += 1; continue; }
    const res = await linkRequestToExistingSystem(supabaseAdmin, row.id, codeNorm);
    if (res.kind === "linked") linked += 1;
    else if (res.kind === "ambiguous") ambiguous += 1;
    // A lost race is not a repair and not a missing system.
    else if (res.kind === "conflict") conflicts += 1;
    else missing += 1;
  }
  return { scanned: (data ?? []).length, linked, ambiguous, missing, conflicts };
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

/**
 * Adds the caller phone that came with the request to the system card.
 *
 * Shared by the automatic pipeline and by a manual decision so both behave
 * identically. Everything happens inside one DB transaction: the row is locked,
 * the number is compared against the primary and the additional numbers, it is
 * written either as the primary (when there is none) or appended to the
 * additional list, and only then the request is stamped. A retry therefore
 * cannot create a duplicate number, and no number is ever invented.
 */
export async function addCallerPhone(
  supabaseAdmin: any,
  req: { id: string; phone_added_at?: string | null },
  systemId: string,
  phone: string | null | undefined,
) {
  if (!phone || !String(phone).trim() || req.phone_added_at) return false;
  const { data, error } = await supabaseAdmin.rpc("add_request_caller_phone", {
    _request_id: req.id,
    _system_id: systemId,
    _phone: phone,
  });
  // A technical failure must retry; it must not silently drop the phone.
  if (error) throw new Error(`הוספת טלפון הפונה נכשלה: ${error.message}`);
  return data === true;
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
    mode = await readAutomationMode(supabaseAdmin, crmKey);
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
    // The relay's own extraction wins when present; otherwise the body of THIS
    // message is parsed. Never inherited from another message in the thread.
    report_description: (String(payload.reportDescription ?? "").trim() || parsed.reportDescription) ?? null,
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
      // A soft-deleted original still holds the business key (the partial
      // index only excludes rows already flagged as duplicates), so it is
      // still "the" row this insert collided with. But a deleted original was
      // explicitly removed from the queue — silently stamping this new row as
      // a duplicate of it would make it vanish from view too. Instead it is
      // linked (to satisfy the constraint and keep the audit trail) but left
      // for a human to decide.
      const { data: original } = await supabaseAdmin
        .from("system_requests").select("id, deleted_at")
        .eq("crm_key", crmKey)
        .eq("request_type", requestType)
        .eq("system_code_norm", parsed.systemCodeNorm)
        .eq("request_number", parsed.requestNumber)
        .is("duplicate_of", null)
        .maybeSingle();
      const originalDeleted = Boolean((original as any)?.deleted_at);
      await supabaseAdmin.from("system_requests").insert({
        ...insertRow,
        duplicate_of: (original as any)?.id ?? null,
        processing_state: "done",
        last_completed_state: "parsed",
        decision_status: originalDeleted ? "needs_decision" : "duplicate",
        dry_run: false,
        last_error: originalDeleted
          ? "בקשה עם אותו מספר קיימת אך נמחקה — נדרשת החלטה ידנית"
          : "כפילות — אותה בקשה כבר נקלטה",
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
  // A soft-deleted request was explicitly taken out of the queue. A re-scan of
  // the same Gmail message must never resurrect it or create a second row for
  // the same message id (that id is still unique in the DB).
  if (req.deleted_at) {
    return { ok: true, completed: true, skipped: true, reason: "deleted", requestId: req.id };
  }
  // A re-scan of the same message must never blank a stored description, and
  // must never write the description of a different message onto this row.
  const incomingDescription = (String(payload.reportDescription ?? "").trim() || parsed.reportDescription) ?? null;
  if (incomingDescription && !String(req.report_description ?? "").trim()) {
    const { error: descError } = await supabaseAdmin.from("system_requests")
      .update({ report_description: incomingDescription }).eq("id", req.id);
    if (descError) {
      return { ok: false, completed: false, retry: true, error: `שמירת תאור הדיווח נכשלה: ${descError.message}` };
    }
    req.report_description = incomingDescription;
  }
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
        const defaultStatus = await readDefaultStatus(supabaseAdmin, requestType, crmKey);
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
      await applyStatusSideEffects(supabaseAdmin, system.id, outcome.toStatus as string, req.id);
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

// ---------------------------------------------------------------------------
// System-name matching + soft delete/restore for the requests screen.
// ---------------------------------------------------------------------------

import type { SystemLite, ConfirmedMatch } from "@/lib/system-matching";
import { computeNameMatch, decideRootCreation } from "@/lib/system-matching";

/** Candidate systems (with their parent, for root resolution) for a typed name. */
export async function queryCandidateSystemsByName(
  supabaseAdmin: any, crmKey: string, name: string,
): Promise<SystemLite[]> {
  const q = String(name ?? "").trim();
  if (!q) return [];
  const { data, error } = await supabaseAdmin
    .from("systems")
    .select("id, name, system_code, parent_system_id, parent:parent_system_id(id, name, system_code, parent_system_id)")
    .ilike("name", q)
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as SystemLite[];
}

/** Pure match computed against freshly-loaded candidates — never trusts a cached list. */
export async function matchSystemNameForRequest(supabaseAdmin: any, crmKey: string, name: string) {
  const rows = await queryCandidateSystemsByName(supabaseAdmin, crmKey, name);
  return computeNameMatch(name, rows);
}

/**
 * Re-evaluates a "create a new root anyway" decision against the CURRENT
 * matches, never against a bare client boolean. See `decideRootCreation`.
 */
export async function checkManualRootCreation(
  supabaseAdmin: any, crmKey: string, name: string, snapshot: ConfirmedMatch[] | null | undefined,
) {
  const match = await matchSystemNameForRequest(supabaseAdmin, crmKey, name);
  const currentMatches: ConfirmedMatch[] = match.parentOptions.map((o) => ({
    id: o.id, name: o.name, system_code: o.system_code,
  }));
  return decideRootCreation(currentMatches, snapshot);
}

export type ManualSystemAction = "link_existing" | "create_sub" | "create_root";

export type ManualSystemActionResult =
  | { ok: true; systemId: string }
  | { ok: false; conflict: true; matches: ConfirmedMatch[] };

/**
 * Executes a manually chosen "which system does this request belong to"
 * decision. The decision (action + targets + the confirmed-matches snapshot)
 * is ALWAYS persisted on the request row first, so a crash between the
 * decision and its side effect is resumable and never re-interpreted from a
 * stale state. `link_existing` never creates anything; `create_sub` always
 * hangs off the given parent; `create_root` re-checks for a conflicting name
 * against the confirmed-matches snapshot and refuses to insert a duplicate
 * root — a unique-violation race is reported the same way, never thrown.
 */
export async function executeManualSystemAction(
  supabaseAdmin: any,
  req: {
    id: string;
    crm_key: string;
    system_code_raw?: string | null;
    system_code_norm?: string | null;
    caller_phone?: string | null;
  },
  params: {
    systemAction: ManualSystemAction;
    targetSystemId?: string | null;
    parentSystemId?: string | null;
    confirmedMatches?: ConfirmedMatch[] | null;
    name?: string | null;
  },
): Promise<ManualSystemActionResult> {
  // ---- persist the decision BEFORE any side effect ------------------------
  const { error: persistError } = await supabaseAdmin.from("system_requests").update({
    manual_system_action: params.systemAction,
    manual_target_system_id: params.targetSystemId ?? null,
    manual_target_parent_system_id: params.parentSystemId ?? null,
    manual_root_confirmed_matches: params.confirmedMatches ?? null,
  }).eq("id", req.id);
  if (persistError) throw new Error(`שמירת פעולת המערכת נכשלה: ${persistError.message}`);

  const linkRequest = async (systemId: string) => {
    const { data: rows, error } = await supabaseAdmin
      .from("system_requests").update({ system_id: systemId }).eq("id", req.id).select("id");
    if (error) throw new Error(`קישור הבקשה למערכת נכשל: ${error.message}`);
    if (!rows?.length) throw new Error("קישור הבקשה למערכת נכשל — רענן ונסה שוב");
  };

  if (params.systemAction === "link_existing") {
    if (!params.targetSystemId) throw new Error("יש לבחור מערכת קיימת");
    await linkRequest(params.targetSystemId);
    return { ok: true, systemId: params.targetSystemId };
  }

  if (params.systemAction === "create_sub") {
    if (!params.parentSystemId) throw new Error("יש לבחור מערכת אב");
    const name = String(params.name ?? "").trim();
    const { data: created, error } = await supabaseAdmin.from("systems").insert({
      system_code: req.system_code_raw ?? req.system_code_norm ?? null,
      name: name || `מערכת ${req.system_code_norm ?? ""}`.trim(),
      name_pending: !name,
      parent_system_id: params.parentSystemId,
      caller_phone: req.caller_phone ?? null,
      source: "בקשה מהמייל",
    }).select("id").maybeSingle();
    if (error) throw new Error(`יצירת תת-המערכת נכשלה: ${error.message}`);
    const systemId = (created as any)?.id as string | undefined;
    if (!systemId) throw new Error("יצירת תת-המערכת נכשלה");
    await linkRequest(systemId);
    return { ok: true, systemId };
  }

  // create_root
  const name = String(params.name ?? "").trim();
  if (!name) throw new Error("יש לבחור שם למערכת החדשה");
  const decision = await checkManualRootCreation(supabaseAdmin, req.crm_key, name, params.confirmedMatches ?? null);
  if (decision.outcome === "conflict") {
    return { ok: false, conflict: true, matches: decision.matches };
  }

  const { data: created, error } = await supabaseAdmin.from("systems").insert({
    system_code: req.system_code_raw ?? req.system_code_norm ?? null,
    name,
    name_pending: false,
    parent_system_id: null,
    caller_phone: req.caller_phone ?? null,
    source: "בקשה מהמייל",
  }).select("id").maybeSingle();
  if (error) {
    // A concurrent creation of the same root name is a business conflict,
    // never a technical failure to surface as a throw.
    const text = `${(error as any).code ?? ""} ${error.message ?? ""}`.toLowerCase();
    const isUniqueViolation = (error as any).code === "23505" || /unique|duplicate/.test(text);
    if (!isUniqueViolation) throw new Error(`יצירת המערכת נכשלה: ${error.message}`);
    const match = await matchSystemNameForRequest(supabaseAdmin, req.crm_key, name);
    const currentMatches: ConfirmedMatch[] = match.parentOptions.map((o) => ({
      id: o.id, name: o.name, system_code: o.system_code,
    }));
    return { ok: false, conflict: true, matches: currentMatches };
  }
  const systemId = (created as any)?.id as string | undefined;
  if (!systemId) throw new Error("יצירת המערכת נכשלה");
  await linkRequest(systemId);
  return { ok: true, systemId };
}

/** Soft-deletes a request; throws on a technical failure or a lost race (already deleted). */
export async function softDeleteSystemRequest(
  supabaseAdmin: any, id: string, actorId: string, reason?: string | null,
): Promise<true> {
  const { data, error } = await supabaseAdmin.rpc("soft_delete_system_request", {
    _id: id, _actor: actorId, _reason: reason ?? null,
  });
  if (error) throw new Error(`מחיקת הבקשה נכשלה: ${error.message}`);
  if (data !== true) throw new Error("הבקשה כבר נמחקה");
  return true;
}

/** Restores a soft-deleted request; throws on a technical failure or if it was not deleted. */
export async function restoreSystemRequestRow(supabaseAdmin: any, id: string, actorId: string): Promise<true> {
  const { data, error } = await supabaseAdmin.rpc("restore_system_request", { _id: id, _actor: actorId });
  if (error) throw new Error(`שחזור הבקשה נכשל: ${error.message}`);
  if (data !== true) throw new Error("הבקשה אינה מחוקה");
  return true;
}
