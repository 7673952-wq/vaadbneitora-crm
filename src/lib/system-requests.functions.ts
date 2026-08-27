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
    let q = context.supabase
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

export const decideSystemRequest = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string; action: "apply" | "keep" | "ignore"; toStatus?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      action: z.enum(["apply", "keep", "ignore"]),
      toStatus: z.string().max(60).nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "status_change"))) throw new Error("אין הרשאה");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req } = await supabaseAdmin
      .from("system_requests").select("*").eq("id", data.id).maybeSingle();
    if (!req) throw new Error("הבקשה לא נמצאה");
    if ((req as any).decision_status && (req as any).decision_status !== "needs_decision") {
      return { ok: true, alreadyDecided: true };
    }

    const patch: any = {
      decided_by: context.userId,
      decided_at: new Date().toISOString(),
      dry_run: false,
    };

    if (data.action === "apply") {
      const toStatus = (data.toStatus ?? (req as any).proposed_status ?? "").trim();
      const systemId = (req as any).system_id;
      if (!toStatus || !systemId) throw new Error("חסר סטטוס יעד או מערכת");
      const { data: sys } = await supabaseAdmin.from("systems").select("status").eq("id", systemId).maybeSingle();
      const from = String((sys as any)?.status ?? "");
      const { data: applied } = await supabaseAdmin.rpc("apply_request_status_change", {
        _request_id: data.id,
        _system_id: systemId,
        _from_status: from,
        _to_status: toStatus,
        _reason: "החלטה ידנית על בקשה מהמייל",
      });
      if (applied !== true) throw new Error("הסטטוס השתנה בינתיים — רענן ונסה שוב");
      const { maybeScheduleOrSendAutoVoice } = await import("@/lib/systems.functions");
      await maybeScheduleOrSendAutoVoice(supabaseAdmin, systemId, toStatus);
      patch.decision_status = "manual_applied";
    } else {
      patch.decision_status = data.action === "keep" ? "kept" : "ignored";
    }
    patch.processing_state = "done";

    const { error } = await supabaseAdmin
      .from("system_requests").update(patch).eq("id", data.id).eq("decision_status", "needs_decision");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Rules =============

export const listRequestRules = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("system_request_rules").select("*").order("sort_order", { ascending: true });
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
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "settings_manage"))) throw new Error("אין הרשאה");
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
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "settings_manage"))) throw new Error("אין הרשאה");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("system_request_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Automation mode =============

export const getRequestAutomationSettings = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings").select("key, value")
      .in("key", ["request_automation_mode", "request_default_status_pticha", "request_default_status_sgira"]);
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
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "settings_manage"))) throw new Error("אין הרשאה");
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
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "systems_read"))) throw new Error("אין הרשאה");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req } = await supabaseAdmin
      .from("system_requests")
      .select("gmail_message_id, attachment_index, attachment_name")
      .eq("id", data.id).maybeSingle();
    if (!req?.gmail_message_id) throw new Error("לא נמצאה הקלטה לבקשה זו");

    const [urlRow, secretRow] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_url").maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_secret").maybeSingle(),
    ]);
    const relayUrl = (urlRow.data?.value as { url?: string } | null)?.url;
    const relaySecret = (secretRow.data?.value as { secret?: string } | null)?.secret;
    if (!relayUrl || !relaySecret) throw new Error("ממשק ה-Gmail אינו מוגדר");

    const { postToRelay } = await import("@/lib/relay.server");
    const res: any = await postToRelay(relayUrl, {
      secret: relaySecret,
      action: "get_attachment",
      gmailMessageId: (req as any).gmail_message_id,
      attachmentIndex: (req as any).attachment_index ?? 0,
    });
    const base64 = res?.base64 ?? res?.data;
    if (!base64) throw new Error("ההקלטה לא נמצאה בגמייל");
    const mime = res?.mimeType || "audio/mpeg";
    return { dataUrl: `data:${mime};base64,${base64}`, name: (req as any).attachment_name ?? "recording" };
  });
