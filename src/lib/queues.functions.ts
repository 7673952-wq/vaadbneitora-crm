import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";

async function assertQueueAdmin(userId: string) {
  const { assertPermission } = await import("@/lib/permissions.server");
  await assertPermission(userId, "settings_manage", "yemot");
}

export const getQueueStatus = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    await assertQueueAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveAppBaseUrl } = await import("@/lib/mentions.server");
    const [{ data: status, error }, { data: baseRow }] = await Promise.all([
      (supabaseAdmin as any).rpc("get_queue_status"),
      supabaseAdmin.from("app_settings").select("value").eq("key", "app_base_url").maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    const envBaseUrlSet = !!(process.env.APP_BASE_URL && process.env.APP_BASE_URL.trim());
    let appBaseUrl: string | null = null;
    try {
      appBaseUrl = await resolveAppBaseUrl(supabaseAdmin);
    } catch {
      appBaseUrl = (baseRow as any)?.value?.url ?? null;
    }
    return { status: status ?? {}, appBaseUrl, envBaseUrlSet };
  });

export const setAppBaseUrl = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { url: string }) => z.object({ url: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertQueueAdmin(context.userId);
    const { limitSensitiveAction } = await import("@/lib/db-rate-limit.server");
    await limitSensitiveAction("queue_config", context.userId);
    const { validateHttpsBaseUrl } = await import("@/lib/mentions.server");
    const normalized = validateHttpsBaseUrl(data.url);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: "app_base_url",
      value: { url: normalized },
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, url: normalized };
  });

export const configureQueueEndpoints = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    await assertQueueAdmin(context.userId);
    const { limitSensitiveAction } = await import("@/lib/db-rate-limit.server");
    await limitSensitiveAction("queue_config", context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveAppBaseUrl } = await import("@/lib/mentions.server");
    const base = await resolveAppBaseUrl(supabaseAdmin);
    if (!base) throw new Error("יש להגדיר קודם כתובת אתר (APP_BASE_URL)");
    const endpoints: Array<[string, string]> = [
      ["voice_queue", `${base}/api/public/hooks/process-voice-queue`],
      ["mention_queue", `${base}/api/public/hooks/process-mention-queue`],
    ];
    for (const [name, url] of endpoints) {
      const { error } = await (supabaseAdmin as any).rpc("set_queue_endpoint", { _name: name, _url: url });
      if (error) throw new Error(error.message);
    }
    return { ok: true, endpoints };
  });

export const checkQueueHealth = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    await assertQueueAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: status } = await (supabaseAdmin as any).rpc("get_queue_status");
    const queues = (status as any)?.queues ?? status ?? {};
    const urls: Record<string, string | undefined> = {
      voice_queue: queues?.voice_queue?.url ?? queues?.voice_queue,
      mention_queue: queues?.mention_queue?.url ?? queues?.mention_queue,
    };
    const results: Record<string, { reachable: boolean; status?: number; error?: string }> = {};
    for (const [name, url] of Object.entries(urls)) {
      if (!url || typeof url !== "string") {
        results[name] = { reachable: false, error: "לא הוגדרה כתובת" };
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, { method: "GET", signal: controller.signal });
        results[name] = { reachable: res.status === 200 || res.status === 405, status: res.status };
      } catch (e: any) {
        results[name] = { reachable: false, error: e?.message ?? "שגיאת רשת" };
      } finally {
        clearTimeout(timer);
      }
    }
    return results;
  });

export const listMentionDeliveries = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    await assertQueueAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("mention_email_deliveries")
      .select("id, status, attempts, last_error, next_retry_at, sent_at, updated_at, mention_id, note_mentions(mentioned_user_id, mentioned_by, crm_key, system_id, record_id)")
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    const rows = (data as any[]) ?? [];
    const userIds = new Set<string>();
    const systemIds = new Set<string>();
    const recordIds = new Set<string>();
    for (const r of rows) {
      const nm = r.note_mentions;
      if (nm?.mentioned_user_id) userIds.add(nm.mentioned_user_id);
      if (nm?.mentioned_by) userIds.add(nm.mentioned_by);
      if (nm?.system_id) systemIds.add(nm.system_id);
      if (nm?.record_id) recordIds.add(nm.record_id);
    }
    const [{ data: profiles }, { data: systems }, { data: records }] = await Promise.all([
      userIds.size ? supabaseAdmin.from("profiles").select("id, display_name").in("id", Array.from(userIds)) : Promise.resolve({ data: [] as any[] }),
      systemIds.size ? supabaseAdmin.from("systems").select("id, system_code").in("id", Array.from(systemIds)) : Promise.resolve({ data: [] as any[] }),
      recordIds.size ? supabaseAdmin.from("crm_records").select("id, record_code").in("id", Array.from(recordIds)) : Promise.resolve({ data: [] as any[] }),
    ] as any);
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));
    const systemMap = new Map((systems ?? []).map((s: any) => [s.id, s.system_code]));
    const recordMap = new Map((records ?? []).map((r: any) => [r.id, r.record_code]));
    return rows.map((r) => {
      const nm = r.note_mentions ?? {};
      return {
        id: r.id,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
        nextRetryAt: r.next_retry_at,
        sentAt: r.sent_at,
        updatedAt: r.updated_at,
        mentionedUserName: profileMap.get(nm.mentioned_user_id) ?? "—",
        mentionedByName: profileMap.get(nm.mentioned_by) ?? "—",
        crmKey: nm.crm_key,
        code: nm.system_id ? systemMap.get(nm.system_id) : (nm.record_id ? recordMap.get(nm.record_id) : null),
      };
    });
  });

export const requeueMentionDelivery = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { deliveryId: string }) => z.object({ deliveryId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertQueueAdmin(context.userId);
    const { limitSensitiveAction } = await import("@/lib/db-rate-limit.server");
    await limitSensitiveAction("mention_requeue", context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ok, error } = await (supabaseAdmin as any).rpc("requeue_mention_delivery", {
      _delivery_id: data.deliveryId,
      _actor: context.userId,
    });
    if (error) throw new Error(error.message);
    if (!ok) throw new Error("לא ניתן היה לשלוח מחדש את ההודעה");
    try {
      await (supabaseAdmin as any).rpc("ensure_mention_queue_job");
    } catch {
      // log-only — best effort arming
    }
    return { ok: true };
  });

export const processMentionQueueNow = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    await assertQueueAdmin(context.userId);
    const { limitSensitiveAction } = await import("@/lib/db-rate-limit.server");
    await limitSensitiveAction("mention_process", context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { processMentionQueue } = await import("@/lib/mentions.server");
    return processMentionQueue(supabaseAdmin);
  });
