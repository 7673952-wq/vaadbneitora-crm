import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";

// Queue, decisions, rules and automation-mode settings for the pticha/sgira
// email automation. Thin wrappers only — logic lives in *.server.ts.

export const listSystemRequests = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { decision?: string | null; limit?: number } | undefined) =>
    z.object({
      decision: z.string().max(40).nullable().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_view");
    // Direct browser access to system_requests is revoked in the DB — reads go
    // through the service-role client behind this permission check.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("system_requests")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.decision) q = q.eq("decision_status", data.decision);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const systemIds = Array.from(new Set((rows ?? []).map((r: any) => r.system_id).filter(Boolean)));
    const systems = systemIds.length
      ? (await context.supabase.from("systems").select("id, system_code, name, status").in("id", systemIds)).data ?? []
      : [];
    const byId = new Map((systems as any[]).map((s) => [s.id, s]));
    return (rows ?? []).map((r: any) => ({ ...r, system: byId.get(r.system_id) ?? null }));
  });

/**
 * A manual decision by an authorized user. This is deliberately NOT blocked by
 * `dry_run`: dry-run only stops the *automatic* pipeline. An explicit click
 * here is a human action and is carried out for real, with the same permission
 * checks, compare-and-swap protection and side effects as a live automatic run.
 */
export const decideSystemRequest = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string; action: "apply" | "keep" | "ignore" | "create_system"; toStatus?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      action: z.enum(["apply", "keep", "ignore", "create_system"]),
      toStatus: z.string().max(60).nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertRequestPermission, assertCrmAccess } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_decide");
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "status_change"))) throw new Error("אין הרשאה");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqError } = await supabaseAdmin
      .from("system_requests").select("*").eq("id", data.id).maybeSingle();
    if (reqError) throw new Error(reqError.message);
    if (!req) throw new Error("הבקשה לא נמצאה");
    await assertCrmAccess(context.supabase, context.userId, (req as any).crm_key);
    // `simulated` is a dry-run conclusion that was never applied, so it is still
    // open for a manual decision; anything else is already decided.
    const OPEN = ["needs_decision", "simulated"];
    const current = (req as any).decision_status as string | null;
    if (current && !OPEN.includes(current)) {
      return { ok: true, alreadyDecided: true };
    }

    const patch: any = {
      decided_by: context.userId,
      decided_at: new Date().toISOString(),
      dry_run: false,
    };
    const { addCallerPhone, applyStatusSideEffects, findSystemsByNormalizedCode, linkRequestToExistingSystem } =
      await import("@/lib/system-requests.server");

    if (data.action === "create_system") {
      const codeNorm = String((req as any).system_code_norm ?? "").trim();
      if (!codeNorm) throw new Error("אין מספר מערכת לבקשה זו");
      if ((req as any).system_id) throw new Error("הבקשה כבר משויכת למערכת");

      // Re-check right before creating: the system may exist already, created
      // meanwhile or simply never linked to this request.
      const link = await linkRequestToExistingSystem(supabaseAdmin, data.id, codeNorm);
      if (link.kind === "ambiguous") return { ok: true, multipleMatches: true };
      if (link.kind === "linked") return { ok: true, linkedExisting: true, systemId: link.systemId };

      const toStatus = String(data.toStatus ?? (req as any).proposed_status ?? "").trim();
      if (!toStatus) throw new Error("יש לבחור סטטוס למערכת החדשה");
      const { data: created, error: createError } = await supabaseAdmin.from("systems").insert({
        system_code: (req as any).system_code_raw ?? codeNorm,
        name: `מערכת ${codeNorm}`,
        name_pending: true,
        status: toStatus as any,
        caller_phone: (req as any).caller_phone ?? null,
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

      // Link the request to the new system BEFORE the side effects, so a crash
      // in the middle can never leave a created system with no link back.
      const { error: linkError } = await supabaseAdmin.from("system_requests").update({
        system_id: systemId,
        new_status: toStatus,
        status_applied_at: new Date().toISOString(),
        last_completed_state: "matched",
      }).eq("id", data.id);
      if (linkError) throw new Error(`קישור הבקשה למערכת נכשל: ${linkError.message}`);

      await applyStatusSideEffects(supabaseAdmin, systemId, toStatus, data.id);
      patch.decision_status = "manual_applied";
    } else if (data.action === "apply") {
      const toStatus = (data.toStatus ?? (req as any).proposed_status ?? "").trim();
      const systemId = (req as any).system_id;
      if (!toStatus || !systemId) throw new Error("חסר סטטוס יעד או מערכת");
      const { data: sys, error: sysError } = await supabaseAdmin
        .from("systems").select("status").eq("id", systemId).maybeSingle();
      if (sysError) throw new Error(sysError.message);
      const from = String((sys as any)?.status ?? "");
      if (from === toStatus) {
        // Nothing to change — treat it as "handled without a status change",
        // which still records the caller phone.
        await addCallerPhone(supabaseAdmin, req as any, systemId, (req as any).caller_phone);
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
        await addCallerPhone(supabaseAdmin, req as any, systemId, (req as any).caller_phone);
        await applyStatusSideEffects(supabaseAdmin, systemId, toStatus, data.id);
        patch.decision_status = "manual_applied";
      }
    } else if (data.action === "keep") {
      // Handled, status untouched — but the caller phone is still recorded.
      const systemId = (req as any).system_id;
      if (!systemId) throw new Error("אין מערכת משויכת — לא ניתן להשאיר סטטוס ללא שינוי");
      await addCallerPhone(supabaseAdmin, req as any, systemId, (req as any).caller_phone);
      patch.decision_status = "kept";
    } else {
      // ignore: nothing at all is written to the system card.
      patch.decision_status = "ignored";
    }
    patch.processing_state = "done";

    const { error } = await supabaseAdmin
      .from("system_requests").update(patch).eq("id", data.id).in("decision_status", OPEN);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const { assertRequestPermission, assertCrmAccess } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_decide");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error: reqError } = await supabaseAdmin
      .from("system_requests").select("id, crm_key, decision_status, system_id").eq("id", data.id).maybeSingle();
    if (reqError) throw new Error(reqError.message);
    if (!req) throw new Error("הבקשה לא נמצאה");
    await assertCrmAccess(context.supabase, context.userId, (req as any).crm_key);
    if (!["needs_decision", "simulated", null].includes((req as any).decision_status)) {
      throw new Error("הבקשה כבר טופלה");
    }

    const { normalizeSystemCode } = await import("@/lib/system-code");
    const codeNorm = normalizeSystemCode(data.systemCode);
    if (!codeNorm) throw new Error("מספר מערכת לא תקין");
    const { findSystemsByNormalizedCode } = await import("@/lib/system-requests.server");
    const matches = await findSystemsByNormalizedCode(supabaseAdmin, codeNorm);
    if (matches.length > 1) throw new Error("נמצאה יותר ממערכת אחת עם מספר זה");
    const { error } = await supabaseAdmin.from("system_requests").update({
      system_code_raw: data.systemCode.trim(),
      system_code_norm: codeNorm,
      system_id: matches.length === 1 ? (matches[0] as any).id : null,
      prev_status: matches.length === 1 ? ((matches[0] as any).status ?? null) : null,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, matched: matches.length === 1 };
  });


// ============= Rules =============

export const listRequestRules = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("system_request_rules").select("*").eq("crm_key", "yemot").order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveRequestRule = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: {
    id?: string | null; request_type: "pticha" | "sgira"; from_status?: string | null;
    action: "set_status" | "keep" | "needs_decision" | "ignore"; to_status?: string | null; is_active?: boolean;
  }) => z.object({
    id: z.string().uuid().nullable().optional(),
    request_type: z.enum(["pticha", "sgira"]),
    from_status: z.string().max(60).nullable().optional(),
    action: z.enum(["set_status", "keep", "needs_decision", "ignore"]),
    to_status: z.string().max(60).nullable().optional(),
    is_active: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_manage");
    if (data.action === "set_status" && !data.to_status) throw new Error("יש לבחור סטטוס יעד");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      crm_key: "yemot",
      request_type: data.request_type,
      from_status: data.from_status?.trim() ? data.from_status.trim() : null,
      action: data.action,
      to_status: data.action === "set_status" ? data.to_status : null,
      is_active: data.is_active ?? true,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("system_request_rules").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
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
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("system_request_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Automation mode =============

export const getRequestAutomationSettings = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_view");
    // Read through the service-role client: a requests_view user without admin
    // rights would otherwise be filtered by RLS and silently see "dry_run".
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings").select("key, value")
      .in("key", ["request_automation_mode", "request_default_status_pticha", "request_default_status_sgira"]);
    if (error) throw new Error(`טעינת הגדרות האוטומציה נכשלה: ${error.message}`);
    const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
    return {
      mode: (map.get("request_automation_mode") as any)?.mode ?? "dry_run",
      defaultPticha: (map.get("request_default_status_pticha") as any)?.status ?? null,
      defaultSgira: (map.get("request_default_status_sgira") as any)?.status ?? null,
    };
  });

export const setRequestAutomationSettings = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { mode: "off" | "dry_run" | "live"; defaultPticha?: string | null; defaultSgira?: string | null }) =>
    z.object({
      mode: z.enum(["off", "dry_run", "live"]),
      defaultPticha: z.string().max(60).nullable().optional(),
      defaultSgira: z.string().max(60).nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const rows = [
      { key: "request_automation_mode", value: { mode: data.mode }, updated_at: now, updated_by: context.userId },
      { key: "request_default_status_pticha", value: { status: data.defaultPticha ?? null }, updated_at: now, updated_by: context.userId },
      { key: "request_default_status_sgira", value: { status: data.defaultSgira ?? null }, updated_at: now, updated_by: context.userId },
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
    const { assertRequestPermission, assertCrmAccess } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req } = await supabaseAdmin
      .from("system_requests")
      .select("gmail_message_id, attachment_index, attachment_name, crm_key")
      .eq("id", data.id).maybeSingle();
    if (!req?.gmail_message_id) throw new Error("לא נמצאה הקלטה לבקשה זו");
    await assertCrmAccess(context.supabase, context.userId, (req as any).crm_key);

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
      gmailMessageId: (req as any).gmail_message_id,
      attachmentIndex: (req as any).attachment_index ?? 0,
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
      name: (req as any).attachment_name ?? "recording",
    };
  });


/**
 * Badge count for the "requests" tab. Gated by `requests_view` so a user
 * without the permission never even triggers a background count query.
 */
export const countPendingRequests = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("system_requests")
      .select("id", { count: "exact", head: true })
      .eq("crm_key", "yemot")
      .eq("processing_state", "done")
      .eq("decision_status", "needs_decision");
    return { count: count ?? 0 };
  });

/** Compact daily summary for the dashboard strip. */
export const getRequestsSummary = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("system_requests")
      .select("decision_status, request_type, dry_run, received_at")
      .eq("crm_key", "yemot")
      .gte("received_at", since)
      .limit(1000);
    const rows = (data ?? []) as any[];
    const { count: pending } = await supabaseAdmin
      .from("system_requests")
      .select("id", { count: "exact", head: true })
      .eq("crm_key", "yemot")
      .eq("decision_status", "needs_decision");
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
    const { assertRequestPermission } = await import("@/lib/requests-access.server");
    await assertRequestPermission(context.userId, "requests_view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("system_requests")
      .select("id, request_type, decision_status, proposed_action, proposed_status, new_status, prev_status, dry_run, received_at, request_number, last_error")
      .eq("system_id", data.systemId)
      .order("received_at", { ascending: false })
      .limit(data.limit ?? 10);
    return rows ?? [];
  });
