import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";

// Queue, decisions, rules and automation-mode settings for the pticha/sgira
// email automation. Thin wrappers only — logic lives in *.server.ts.
//
// Two rules hold everywhere in this file:
//  1. Lists and counters filter the QUERY by the CRMs the caller is allowed in.
//  2. Row actions read the row first and authorize against the CRM stored on
//     it — never against a value coming from the browser.

/** Settings keys are per CRM; the original CRM keeps the historical key names. */
function settingKey(base: string, crmKey: string) {
  return crmKey === "yemot" ? base : `${base}__${crmKey}`;
}

export const listSystemRequests = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { decision?: string | null; limit?: number } | undefined) =>
    z.object({
      decision: z.string().max(40).nullable().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { requireCrmKeysWithPermission } = await import("@/lib/requests-access.server");
    const crmKeys = await requireCrmKeysWithPermission(context.userId, "requests_view");
    // Direct browser access to system_requests is revoked in the DB — reads go
    // through the service-role client, filtered to the caller's CRMs.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("system_requests")
      .select([
        "id", "crm_key", "gmail_message_id", "gmail_thread_id", "request_type", "request_number",
        "system_code_raw", "system_code_norm", "caller_phone", "system_id", "processing_state",
        "decision_status", "dry_run", "prev_status", "proposed_status", "proposed_action",
        "new_status", "status_applied_at", "phone_added_at", "attempts", "last_error",
        "attachment_name", "attachment_index", "subject", "report_description",
        "decided_by", "decided_at", "received_at", "created_at", "updated_at",
        "automation_mode", "duplicate_of", "manual_action", "manual_target_status",
        "manual_target_name", "manual_last_error",
      ].join(", "))
      .in("crm_key", crmKeys)
      .order("received_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.decision === "open") {
      // Everything still waiting for a human: never decided, or decided only
      // as a test run while the automation is in check mode.
      const { OPEN_DECISIONS } = await import("@/lib/system-requests.server");
      q = q.in("decision_status", OPEN_DECISIONS);
    } else if (data.decision) {
      q = q.eq("decision_status", data.decision);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const systemIds = Array.from(new Set((rows ?? []).map((r: any) => r.system_id).filter(Boolean)));
    const systems = systemIds.length
      ? (await context.supabase.from("systems").select("id, system_code, name, status, name_pending").in("id", systemIds)).data ?? []
      : [];
    const byId = new Map((systems as any[]).map((s) => [s.id, s]));
    return (rows ?? []).map((r: any) => ({ ...r, system: byId.get(r.system_id) ?? null }));
  });

/**
 * A manual decision by an authorized user. This is deliberately NOT blocked by
 * `dry_run`: dry-run only stops the *automatic* pipeline. An explicit click
 * here is a human action and is carried out for real, with the same permission
 * checks and side effects as a live automatic run.
 *
 * The request is CLAIMED atomically in the database before the first write, so
 * two people clicking different actions at the same moment can never both act:
 * the loser gets no side effects and no success answer.
 */
export const decideSystemRequest = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string; action: "apply" | "keep" | "ignore" | "create_system"; toStatus?: string | null; name?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      action: z.enum(["apply", "keep", "ignore", "create_system"]),
      toStatus: z.string().max(60).nullable().optional(),
      name: z.string().max(120).nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { loadAuthorizedRequest, assertKnownStatus } = await import("@/lib/requests-access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { crmKey } = await loadAuthorizedRequest(
      supabaseAdmin, context.supabase, context.userId, data.id, "requests_decide",
      "id, crm_key, decision_status",
    );
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "status_change", crmKey))) throw new Error("אין הרשאה");

    const { enforceDbRateLimit } = await import("@/lib/db-rate-limit.server");
    await enforceDbRateLimit(supabaseAdmin, { scope: "request_decide", identity: context.userId });

    // Atomic claim: only the winner may run any side effect below.
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc("claim_system_request", {
      _id: data.id, _actor: context.userId,
    });
    if (claimError) throw new Error(`נעילת הבקשה נכשלה: ${claimError.message}`);
    if (!claimed) {
      // Losing the claim means this request was NOT carried out. It must never
      // be answered as a success.
      const { data: current } = await supabaseAdmin
        .from("system_requests").select("decision_status, decision_claim_at").eq("id", data.id).maybeSingle();
      const { OPEN_DECISIONS: OPENNOW } = await import("@/lib/system-requests.server");
      const stillOpen = OPENNOW.includes(String((current as any)?.decision_status ?? ""));
      return {
        ok: false as const,
        status: stillOpen ? ("already_processing" as const) : ("already_decided" as const),
        message: stillOpen
          ? "משתמש אחר מטפל כרגע בבקשה זו — נסה שוב בעוד רגע"
          : "הבקשה כבר הוכרעה על ידי משתמש אחר — רענן את הרשימה",
      };
    }
    const req = claimed as any;

    // The release is guarded by the actor in the DB: a stale attempt coming
    // back to life can never clear the claim someone else now holds.
    const release = async (lastError?: string) => {
      await supabaseAdmin.rpc("release_system_request_claim", {
        _id: data.id, _actor: context.userId, _error: lastError ?? null,
      });
    };

    // ---- Durable intent -----------------------------------------------
    // A decision that has already started owns the request. A retry resumes
    // exactly that decision; a DIFFERENT action is refused instead of turning
    // a half-finished `apply` into a `keep`/`ignore`.
    const { addCallerPhone, applyStatusSideEffects, findSystemsByNormalizedCode, linkRequestToExistingSystem, planManualDecision, normalizeIntentValue, OPEN_DECISIONS: OPEN } =
      await import("@/lib/system-requests.server");
    const plan = planManualDecision(req, data.action, data.toStatus ?? null, data.name ?? null);
    if (plan.mode === "conflict") {
      await release();
      throw new Error("פעולה אחרת על בקשה זו כבר החלה ולא הושלמה — יש להשלים אותה תחילה");
    }
    const resuming = plan.mode === "resume";
    const intentStatus = plan.targetStatus;
    const intentName = plan.targetName;

    const patch: any = {
      decided_by: context.userId,
      decided_at: new Date().toISOString(),
      dry_run: false,
      decision_claim_at: null,
      decision_claim_by: null,
      manual_last_error: null,
    };


    /** Side effects run once per request; a resume skips what already ran. */
    const runSideEffectsOnce = async (systemId: string, toStatus: string) => {
      if (req.side_effects_completed_at) return;
      await applyStatusSideEffects(supabaseAdmin, systemId, toStatus, data.id);
      const { error } = await supabaseAdmin.from("system_requests")
        .update({ side_effects_completed_at: new Date().toISOString() }).eq("id", data.id);
      if (error) throw new Error(`סימון סיום הפעולות הנלוות נכשל: ${error.message}`);
    };

    try {
      if (!resuming) {
        // Persist the intent BEFORE the first side effect, so any crash from
        // here on is resumable and can never be re-interpreted. The chosen name
        // is part of the intent, so a retry recreates the SAME card.
        const { data: intentRows, error: intentError } = await supabaseAdmin.from("system_requests").update({
          manual_action: data.action,
          manual_target_status: normalizeIntentValue(data.toStatus ?? req.proposed_status),
          manual_target_name: normalizeIntentValue(data.name),
          manual_started_by: context.userId,
          manual_started_at: new Date().toISOString(),
        }).eq("id", data.id).is("manual_action", null).select("id");
        if (intentError) throw new Error(`שמירת ההחלטה נכשלה: ${intentError.message}`);
        if (!intentRows?.length) throw new Error("פעולה אחרת על בקשה זו כבר החלה — רענן ונסה שוב");
      }

      if (data.action === "create_system") {
        const codeNorm = String(req.system_code_norm ?? "").trim();
        if (!codeNorm) throw new Error("אין מספר מערכת לבקשה זו");
        const toStatus = String(intentStatus ?? data.toStatus ?? req.proposed_status ?? "").trim();

        if (resuming && req.system_id) {
          // The system was already created/linked by the attempt that owns this
          // decision — continue from the step that did not finish.
          if (!toStatus) throw new Error("חסר סטטוס יעד להשלמת הפעולה");
          await runSideEffectsOnce(req.system_id, toStatus);
          patch.decision_status = "manual_applied";
        } else {
          if (req.system_id) throw new Error("הבקשה כבר משויכת למערכת");

          // Re-check inside the claim: the system may exist already, created
          // meanwhile or simply never linked to this request.
          const link = await linkRequestToExistingSystem(supabaseAdmin, data.id, codeNorm);
          if (link.kind === "conflict") {
            // The conditional update matched no row: someone else moved this
            // request meanwhile. Nothing was linked, so nothing is reported.
            await supabaseAdmin.from("system_requests")
              .update({ manual_action: null, manual_target_status: null, manual_target_name: null }).eq("id", data.id);
            await release();
            return { ok: false as const, status: "conflict" as const, message: "הבקשה השתנתה בינתיים — רענן ונסה שוב" };
          }
          if (link.kind === "ambiguous") {
            await supabaseAdmin.from("system_requests")
              .update({ manual_action: null, manual_target_status: null, manual_target_name: null }).eq("id", data.id);
            await release(); return { ok: true, multipleMatches: true };
          }
          if (link.kind === "linked") {
            await supabaseAdmin.from("system_requests")
              .update({ manual_action: null, manual_target_status: null, manual_target_name: null }).eq("id", data.id);
            await release(); return { ok: true, linkedExisting: true, systemId: link.systemId };
          }

          if (!toStatus) throw new Error("יש לבחור סטטוס למערכת החדשה");
          await assertKnownStatus(supabaseAdmin, toStatus);
          // The name may be chosen right here, at creation time; without one the
          // card gets a placeholder marked as "temporary name". A retry reuses
          // the name stored with the intent, not the one sent again now.
          const chosenName = String(intentName ?? data.name ?? "").trim();
          const { data: created, error: createError } = await supabaseAdmin.from("systems").insert({
            system_code: req.system_code_raw ?? codeNorm,
            name: chosenName || `מערכת ${codeNorm}`,
            name_pending: !chosenName,
            status: toStatus as any,
            caller_phone: req.caller_phone ?? null,
            source: "בקשה מהמייל",
          }).select("id").maybeSingle();
          let systemId = (created as any)?.id as string | undefined;
          if (!systemId) {
            // A concurrent creation won the unique code index — adopt that system
            // instead of failing, so a retry never creates a second card.
            const again = await findSystemsByNormalizedCode(supabaseAdmin, codeNorm);
            systemId = again.length === 1 ? (again[0] as any).id : undefined;
          }
          if (!systemId) throw new Error(`יצירת המערכת נכשלה${createError?.message ? `: ${createError.message}` : ""}`);

          // Link BEFORE the side effects, so a crash in the middle can never
          // leave a created system with no link back to its request.
          const { data: linkRows, error: linkError } = await supabaseAdmin.from("system_requests").update({
            system_id: systemId,
            new_status: toStatus,
            status_applied_at: new Date().toISOString(),
            last_completed_state: "matched",
          }).eq("id", data.id).select("id");
          if (linkError) throw new Error(`קישור הבקשה למערכת נכשל: ${linkError.message}`);
          if (!linkRows?.length) throw new Error("קישור הבקשה למערכת לא בוצע — רענן ונסה שוב");

          await runSideEffectsOnce(systemId, toStatus);
          patch.decision_status = "manual_applied";
        }
      } else if (data.action === "apply") {
        const toStatus = String(intentStatus ?? data.toStatus ?? req.proposed_status ?? "").trim();
        const systemId = req.system_id;
        if (!toStatus || !systemId) throw new Error("חסר סטטוס יעד או מערכת");
        await assertKnownStatus(supabaseAdmin, toStatus);

        if (resuming && req.status_applied_at) {
          // The status change of THIS decision already went through; only the
          // remaining steps are replayed. Never downgraded to "kept".
          await addCallerPhone(supabaseAdmin, req, systemId, req.caller_phone);
          await runSideEffectsOnce(systemId, toStatus);
          patch.decision_status = "manual_applied";
        } else {
          const { data: sys, error: sysError } = await supabaseAdmin
            .from("systems").select("status").eq("id", systemId).maybeSingle();
          if (sysError) throw new Error(sysError.message);
          const from = String((sys as any)?.status ?? "");
          if (from === toStatus) {
            // Genuinely nothing to change (no earlier attempt applied it) —
            // handled without a status change, caller phone still recorded.
            await addCallerPhone(supabaseAdmin, req, systemId, req.caller_phone);
            patch.decision_status = "kept";
          } else {
            const { data: applied, error: applyError } = await supabaseAdmin.rpc("apply_request_status_change", {
              _request_id: data.id,
              _system_id: systemId,
              _from_status: from,
              _to_status: toStatus,
              _reason: "החלטה ידנית על בקשה מהמייל",
            });
            // Technical failure vs. a legitimate `false` (the status moved meanwhile).
            if (applyError) throw new Error(`עדכון הסטטוס נכשל: ${applyError.message}`);
            if (applied !== true) throw new Error("הסטטוס השתנה בינתיים — רענן ונסה שוב");
            await addCallerPhone(supabaseAdmin, req, systemId, req.caller_phone);
            await runSideEffectsOnce(systemId, toStatus);
            patch.decision_status = "manual_applied";
          }
        }
      } else if (data.action === "keep") {
        // Handled, status untouched — but the caller phone is still recorded.
        const systemId = req.system_id;
        if (!systemId) throw new Error("אין מערכת משויכת — לא ניתן להשאיר סטטוס ללא שינוי");
        await addCallerPhone(supabaseAdmin, req, systemId, req.caller_phone);
        patch.decision_status = "kept";
      } else {
        // ignore: nothing at all is written to the system card.
        patch.decision_status = "ignored";
      }
      patch.processing_state = "done";

      const { data: updated, error } = await supabaseAdmin
        .from("system_requests").update(patch).eq("id", data.id)
        .in("decision_status", OPEN).select("id");
      if (error) throw new Error(error.message);
      if (!updated?.length) throw new Error("הבקשה כבר טופלה בינתיים — רענן ונסה שוב");
      return { ok: true };
    } catch (e: any) {
      // A failed attempt must never leave the request locked for the next try,
      // and the recorded intent stays so the retry resumes the same decision.
      await release(String(e?.message ?? e).slice(0, 300)).catch(() => {});
      throw e;
    }
  });


/**
 * Fixes the system code on an OLDER request row that was ingested before the
 * "a request must carry a system code" rule existed. New requests without a
 * code are rejected at intake and never reach this screen.
 */
export const setRequestSystemCode = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string; systemCode: string }) =>
    z.object({ id: z.string().uuid(), systemCode: z.string().min(3).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { loadAuthorizedRequest } = await import("@/lib/requests-access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await loadAuthorizedRequest(
      supabaseAdmin, context.supabase, context.userId, data.id, "requests_decide",
      "id, crm_key, decision_status, system_id",
    );

    const { normalizeSystemCode } = await import("@/lib/system-code");
    const codeNorm = normalizeSystemCode(data.systemCode);
    if (!codeNorm) throw new Error("מספר מערכת לא תקין");
    const { findSystemsByNormalizedCode, OPEN_DECISIONS } = await import("@/lib/system-requests.server");
    const matches = await findSystemsByNormalizedCode(supabaseAdmin, codeNorm);
    if (matches.length > 1) throw new Error("נמצאה יותר ממערכת אחת עם מספר זה");
    // CAS: the request must still be open at the moment of the write, and the
    // update must prove it actually changed a row.
    const { data: rows, error } = await supabaseAdmin.from("system_requests").update({
      system_code_raw: data.systemCode.trim(),
      system_code_norm: codeNorm,
      system_id: matches.length === 1 ? (matches[0] as any).id : null,
      prev_status: matches.length === 1 ? ((matches[0] as any).status ?? null) : null,
    }).eq("id", data.id).in("decision_status", OPEN_DECISIONS).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("הבקשה כבר טופלה");
    return { ok: true, matched: matches.length === 1 };
  });

/**
 * Renames the system linked to a request, straight from the requests screen.
 * Used mostly to replace the placeholder name a newly created card gets.
 */
export const renameRequestSystem = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string; name: string }) =>
    z.object({ id: z.string().uuid(), name: z.string().min(2).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { loadAuthorizedRequest } = await import("@/lib/requests-access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { req, crmKey } = await loadAuthorizedRequest(
      supabaseAdmin, context.supabase, context.userId, data.id, "requests_decide",
      "id, crm_key, system_id",
    );
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "systems_write", crmKey))) throw new Error("אין הרשאה");
    if (!req.system_id) throw new Error("אין מערכת משויכת לבקשה זו");

    const name = data.name.trim();
    await supabaseAdmin.rpc("set_change_reason", { p_reason: "שינוי שם מתוך בקשה מהמייל" });
    const { data: rows, error } = await supabaseAdmin
      .from("systems").update({ name, name_pending: false })
      .eq("id", req.system_id).select("id, name");
    if (error) throw new Error(`שינוי השם נכשל: ${error.message}`);
    if (!rows?.length) throw new Error("המערכת לא נמצאה");
    return { ok: true, name };
  });


// ============= Rules =============

export const listRequestRules = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { crmKey?: string | null } | undefined) =>
    z.object({ crmKey: z.string().max(60).nullable().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { requireCrmKeysWithPermission } = await import("@/lib/requests-access.server");
    const allowed = await requireCrmKeysWithPermission(context.userId, "requests_view");
    const keys = data.crmKey ? allowed.filter((k) => k === data.crmKey) : allowed;
    if (!keys.length) throw new Error("אין הרשאה");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("system_request_rules").select("*").in("crm_key", keys)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveRequestRule = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: {
    id?: string | null; crmKey?: string | null; request_type: "pticha" | "sgira"; from_status?: string | null;
    action: "set_status" | "keep" | "needs_decision" | "ignore"; to_status?: string | null; is_active?: boolean;
  }) => z.object({
    id: z.string().uuid().nullable().optional(),
    crmKey: z.string().max(60).nullable().optional(),
    request_type: z.enum(["pticha", "sgira"]),
    from_status: z.string().max(60).nullable().optional(),
    action: z.enum(["set_status", "keep", "needs_decision", "ignore"]),
    to_status: z.string().max(60).nullable().optional(),
    is_active: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { loadAuthorizedRule, assertRequestPermission, assertCrmAccess, assertKnownStatus } =
      await import("@/lib/requests-access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The CRM of an EXISTING rule always comes from the stored row, so a rule
    // can never be moved to another CRM or edited from one.
    let crmKey: string;
    if (data.id) {
      ({ crmKey } = await loadAuthorizedRule(supabaseAdmin, context.supabase, context.userId, data.id));
    } else {
      crmKey = (data.crmKey ?? "yemot").trim() || "yemot";
      await assertCrmAccess(context.supabase, context.userId, crmKey);
      await assertRequestPermission(context.userId, "requests_manage", crmKey);
    }

    if (data.action === "set_status" && !data.to_status) throw new Error("יש לבחור סטטוס יעד");
    // A rule may only point at statuses that actually exist, so an outdated
    // or hand-crafted value can never be stored and silently misfire later.
    await assertKnownStatus(supabaseAdmin, data.from_status);
    await assertKnownStatus(supabaseAdmin, data.to_status);

    const row = {
      crm_key: crmKey,
      request_type: data.request_type,
      from_status: data.from_status?.trim() ? data.from_status.trim() : null,
      action: data.action,
      to_status: data.action === "set_status" ? data.to_status : null,
      is_active: data.is_active ?? true,
      created_by: context.userId,
    };
    if (data.id) {
      const { data: rows, error } = await supabaseAdmin
        .from("system_request_rules").update(row).eq("id", data.id).eq("crm_key", crmKey).select("id");
      if (error) throw new Error(error.message);
      if (!rows?.length) throw new Error("הכלל לא עודכן");
    } else {
      const { error } = await supabaseAdmin.from("system_request_rules").insert(row);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteRequestRule = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { loadAuthorizedRule } = await import("@/lib/requests-access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { crmKey } = await loadAuthorizedRule(supabaseAdmin, context.supabase, context.userId, data.id);
    const { data: rows, error } = await supabaseAdmin
      .from("system_request_rules").delete().eq("id", data.id).eq("crm_key", crmKey).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("הכלל לא נמחק");
    return { ok: true };
  });

// ============= Automation mode =============

export const getRequestAutomationSettings = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { crmKey?: string | null } | undefined) =>
    z.object({ crmKey: z.string().max(60).nullable().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { requireCrmKeysWithPermission } = await import("@/lib/requests-access.server");
    const allowed = await requireCrmKeysWithPermission(context.userId, "requests_view");
    const crmKey = data.crmKey && allowed.includes(data.crmKey) ? data.crmKey : (allowed.includes("yemot") ? "yemot" : allowed[0]!);
    // Read through the service-role client: a requests_view user without admin
    // rights would otherwise be filtered by RLS and silently see "dry_run".
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const keys = [
      settingKey("request_automation_mode", crmKey),
      settingKey("request_default_status_pticha", crmKey),
      settingKey("request_default_status_sgira", crmKey),
    ];
    const { data: rows, error } = await supabaseAdmin
      .from("app_settings").select("key, value").in("key", keys);
    if (error) throw new Error(`טעינת הגדרות האוטומציה נכשלה: ${error.message}`);
    const map = new Map((rows ?? []).map((r: any) => [r.key, r.value]));
    return {
      crmKey,
      mode: (map.get(keys[0]!) as any)?.mode ?? "dry_run",
      defaultPticha: (map.get(keys[1]!) as any)?.status ?? null,
      defaultSgira: (map.get(keys[2]!) as any)?.status ?? null,
    };
  });

export const setRequestAutomationSettings = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { mode: "off" | "dry_run" | "live"; crmKey?: string | null; defaultPticha?: string | null; defaultSgira?: string | null }) =>
    z.object({
      mode: z.enum(["off", "dry_run", "live"]),
      crmKey: z.string().max(60).nullable().optional(),
      defaultPticha: z.string().max(60).nullable().optional(),
      defaultSgira: z.string().max(60).nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertRequestPermission, assertCrmAccess, assertKnownStatus } = await import("@/lib/requests-access.server");
    const crmKey = (data.crmKey ?? "yemot").trim() || "yemot";
    await assertCrmAccess(context.supabase, context.userId, crmKey);
    await assertRequestPermission(context.userId, "requests_manage", crmKey);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertKnownStatus(supabaseAdmin, data.defaultPticha);
    await assertKnownStatus(supabaseAdmin, data.defaultSgira);
    const now = new Date().toISOString();
    const rows = [
      { key: settingKey("request_automation_mode", crmKey), value: { mode: data.mode }, updated_at: now, updated_by: context.userId },
      { key: settingKey("request_default_status_pticha", crmKey), value: { status: data.defaultPticha ?? null }, updated_at: now, updated_by: context.userId },
      { key: settingKey("request_default_status_sgira", crmKey), value: { status: data.defaultSgira ?? null }, updated_at: now, updated_by: context.userId },
    ];
    const { error } = await supabaseAdmin.from("app_settings").upsert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Recording playback =============

/**
 * Streams the request's recording straight from Gmail through the relay and
 * returns it as a data URL. Nothing is persisted in storage — deliberately, so
 * recordings stay in Gmail and the CRM keeps no copy.
 */
export const getRequestAudio = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { loadAuthorizedRequest } = await import("@/lib/requests-access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // `requests_view` is checked against the CRM stored on the request itself,
    // so viewing rights in one CRM never unlock another CRM's recording.
    const { req } = await loadAuthorizedRequest(
      supabaseAdmin, context.supabase, context.userId, data.id, "requests_view",
      "gmail_message_id, attachment_index, attachment_name, crm_key",
    );
    if (!req.gmail_message_id) throw new Error("לא נמצאה הקלטה לבקשה זו");

    const [urlRow, secretRow] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_url").maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_secret").maybeSingle(),
    ]);
    const relayUrl = (urlRow.data?.value as { url?: string } | null)?.url;
    const relaySecret = (secretRow.data?.value as { secret?: string } | null)?.secret;
    if (!relayUrl || !relaySecret) throw new Error("ממשק ה-Gmail אינו מוגדר");

    const { postToRelay } = await import("@/lib/relay.server");
    const relayRes = await postToRelay(relayUrl, {
      secret: relaySecret,
      action: "get_attachment",
      gmailMessageId: req.gmail_message_id,
      attachmentIndex: req.attachment_index ?? 0,
    });
    // postToRelay returns a Response — the JSON body has to be read out of it.
    let res: any = null;
    try {
      res = await relayRes.json();
    } catch {
      throw new Error("תשובה לא תקינה מממשק ה-Gmail");
    }
    if (res?.ok === false) throw new Error(String(res?.error ?? "ההקלטה לא נמצאה בגמייל"));

    const base64: string | undefined = res?.base64 ?? res?.data;
    if (!base64) throw new Error("ההקלטה לא נמצאה בגמייל");

    // ~15MB cap (base64 is ~4/3 of the raw size) so a huge attachment cannot
    // be streamed into the browser as a data URL.
    if (base64.length > 20_000_000) throw new Error("ההקלטה גדולה מדי להשמעה בדפדפן");

    const mime = String(res?.mimeType || "audio/mpeg");
    if (!/^audio\/|^application\/octet-stream$/.test(mime)) {
      throw new Error("הקובץ המצורף אינו קובץ שמע");
    }
    return {
      dataUrl: `data:${mime.startsWith("audio/") ? mime : "audio/mpeg"};base64,${base64}`,
      name: req.attachment_name ?? "recording",
    };
  });


/**
 * Badge count for the "requests" tab. Counts only requests in CRMs where the
 * caller actually holds `requests_view`.
 */
export const countPendingRequests = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { crmKeysWithPermission } = await import("@/lib/requests-access.server");
    const crmKeys = await crmKeysWithPermission(context.userId, "requests_view");
    if (!crmKeys.length) return { count: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("system_requests")
      .select("id", { count: "exact", head: true })
      .in("crm_key", crmKeys)
      .eq("processing_state", "done")
      .in("decision_status", (await import("@/lib/system-requests.server")).OPEN_DECISIONS);
    return { count: count ?? 0 };
  });

/**
 * Repairs open requests whose system code exists in `systems` today but which
 * were never linked. Links only unambiguous matches; changes no status.
 */
export const repairUnlinkedRequests = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { requireCrmKeysWithPermission } = await import("@/lib/requests-access.server");
    const crmKeys = await requireCrmKeysWithPermission(context.userId, "requests_decide");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { relinkOpenRequests } = await import("@/lib/system-requests.server");
    const totals = { scanned: 0, linked: 0, ambiguous: 0, missing: 0 };
    for (const key of crmKeys) {
      const res = await relinkOpenRequests(supabaseAdmin, key);
      totals.scanned += res.scanned;
      totals.linked += res.linked;
      totals.ambiguous += res.ambiguous;
      totals.missing += res.missing;
    }
    return totals;
  });

/** Compact daily summary for the dashboard strip. */
export const getRequestsSummary = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { crmKeysWithPermission } = await import("@/lib/requests-access.server");
    const crmKeys = await crmKeysWithPermission(context.userId, "requests_view");
    if (!crmKeys.length) return { today: 0, pticha: 0, sgira: 0, applied: 0, dryRun: 0, pending: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("system_requests")
      .select("decision_status, request_type, dry_run, received_at")
      .in("crm_key", crmKeys)
      .gte("received_at", since)
      .limit(1000);
    const rows = (data ?? []) as any[];
    const { count: pending } = await supabaseAdmin
      .from("system_requests")
      .select("id", { count: "exact", head: true })
      .in("crm_key", crmKeys)
      .in("decision_status", (await import("@/lib/system-requests.server")).OPEN_DECISIONS);
    return {
      today: rows.length,
      pticha: rows.filter((r) => r.request_type === "pticha").length,
      sgira: rows.filter((r) => r.request_type === "sgira").length,
      applied: rows.filter((r) => r.decision_status === "auto_applied" || r.decision_status === "manual_applied").length,
      dryRun: rows.filter((r) => r.dry_run).length,
      pending: pending ?? 0,
    };
  });

/** Request history shown inside a system card (requests_view only). */
export const listRequestsForSystem = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { systemId: string; limit?: number }) =>
    z.object({ systemId: z.string().uuid(), limit: z.number().int().min(1).max(50).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { crmKeysWithPermission } = await import("@/lib/requests-access.server");
    const crmKeys = await crmKeysWithPermission(context.userId, "requests_view");
    if (!crmKeys.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("system_requests")
      .select("id, request_type, decision_status, proposed_action, proposed_status, new_status, prev_status, dry_run, received_at, request_number, last_error")
      .eq("system_id", data.systemId)
      .in("crm_key", crmKeys)
      .order("received_at", { ascending: false })
      .limit(data.limit ?? 10);
    return rows ?? [];
  });
