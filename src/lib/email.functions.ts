import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeText, sanitizeOptional } from "@/lib/sanitize";

async function ensureCanWrite(userId: string) {
  const { assertCanWrite } = await import("@/lib/permissions.server");
  await assertCanWrite(userId);
}

// ============= Relay connection settings (Apps Script Web App) =============
const RELAY_URL_KEY = "email_relay_url";
const RELAY_SECRET_KEY = "email_relay_secret";
const RELAY_ADDRESS_KEY = "email_relay_address";

export const getEmailRelayConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAnyPermission } = await import("@/lib/permissions.server");
    await assertAnyPermission(context.userId, ["backup_manage", "settings_manage"]);
    const { data } = await context.supabase
      .from("app_settings").select("key, value").in("key", [RELAY_URL_KEY, RELAY_SECRET_KEY, RELAY_ADDRESS_KEY]);
    const get = (k: string) => (data ?? []).find((r: any) => r.key === k)?.value as Record<string, string> | undefined;
    return {
      url: get(RELAY_URL_KEY)?.url ?? "",
      address: get(RELAY_ADDRESS_KEY)?.address ?? "",
      hasSecret: !!get(RELAY_SECRET_KEY)?.secret,
    };
  });

export const setEmailRelayConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string; address: string; secret?: string }) =>
    z.object({
      url: z.string().max(300).refine((v) => v === "" || /^https:\/\//.test(v), "כתובת חייבת להתחיל ב-https"),
      address: z.string().max(200).refine((v) => v === "" || /.+@.+\..+/.test(v), "כתובת מייל לא תקינה"),
      secret: z.string().max(300).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "backup_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const upserts = [
      { key: RELAY_URL_KEY, value: { url: data.url.replace(/\/$/, "") } },
      { key: RELAY_ADDRESS_KEY, value: { address: data.address } },
    ];
    for (const row of upserts) {
      const { error } = await supabaseAdmin.from("app_settings").upsert({ ...row, updated_at: now, updated_by: context.userId });
      if (error) throw new Error(error.message);
    }
    if (data.secret) {
      const { error } = await supabaseAdmin.from("app_settings").upsert({
        key: RELAY_SECRET_KEY, value: { secret: data.secret }, updated_at: now, updated_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ============= Agent display name + signature =============
export const getMyEmailProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles").select("display_name, email_signature" as any).eq("id", context.userId).maybeSingle();
    if (error) throw new Error(error.message);
    return { displayName: (data as any)?.display_name ?? "", signature: (data as any)?.email_signature ?? "" };
  });

export const setMyEmailSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { signature: string }) => z.object({ signature: z.string().max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles" as any).update({ email_signature: sanitizeOptional(data.signature) ?? "" }).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Templates =============
export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("email_templates" as any).select("*").order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; name: string; subject: string; body: string }) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(200),
      subject: z.string().max(300),
      body: z.string().max(5000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "settings_manage");
    const row = {
      name: sanitizeText(data.name), subject: sanitizeOptional(data.subject) ?? "",
      body: sanitizeOptional(data.body) ?? "", updated_at: new Date().toISOString(),
    };
    const { error } = data.id
      ? await context.supabase.from("email_templates" as any).update(row).eq("id", data.id)
      : await context.supabase.from("email_templates" as any).insert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "settings_manage");
    const { error } = await context.supabase.from("email_templates" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Admin: per-agent email display name override =============
// Lets an admin decide what name each agent's outgoing mail shows as,
// regardless of their regular in-app display_name.
export const listAgentEmailNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles").select("id, display_name, email_display_name" as any).order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { id: string; display_name: string; email_display_name: string | null }[];
  });

export const setAgentEmailDisplayName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; email_display_name: string }) =>
    z.object({ user_id: z.string().uuid(), email_display_name: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles" as any)
      .update({ email_display_name: sanitizeOptional(data.email_display_name) || null })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Thread for a system =============
export const listSystemEmailThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string }) => z.object({ system_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("email_messages" as any).select("*").eq("system_id", data.system_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============= Send / reply =============
export const sendSystemEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string; to: string; subject: string; body: string; gmail_thread_id?: string | null }) =>
    z.object({
      system_id: z.string().uuid(),
      to: z.string().email(),
      subject: z.string().max(300),
      body: z.string().min(1).max(20000),
      gmail_thread_id: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: relayUrlRow }, { data: relaySecretRow }, { data: profileRow }] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_URL_KEY).maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_SECRET_KEY).maybeSingle(),
      supabaseAdmin.from("profiles").select("display_name, email_signature, email_display_name" as any).eq("id", context.userId).maybeSingle(),
    ]);
    const relayUrl = (relayUrlRow?.value as { url?: string } | null)?.url;
    const relaySecret = (relaySecretRow?.value as { secret?: string } | null)?.secret;
    if (!relayUrl || !relaySecret) {
      throw new Error("שליחת מייל לא מוגדרת עדיין — יש להגדיר את חיבור Gmail תחת ניהול → מיילים");
    }
    const agentName = (profileRow as any)?.email_display_name || (profileRow as any)?.display_name || "נציג";
    const agentSignature = (profileRow as any)?.email_signature || "";

    const relayPayload = data.gmail_thread_id
      ? { secret: relaySecret, action: "reply", gmailThreadId: data.gmail_thread_id, body: data.body, agentName, agentSignature }
      : { secret: relaySecret, action: "send", to: data.to, subject: data.subject, body: data.body, agentName, agentSignature };

    let relayRes: Response;
    try {
      relayRes = await fetch(relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(relayPayload),
      });
    } catch {
      throw new Error("לא ניתן להתחבר לשרת השליחה (Apps Script) — בדוק את הכתובת בהגדרות");
    }
    const relayJson: any = await relayRes.json().catch(() => ({}));
    if (!relayRes.ok || !relayJson?.ok) {
      throw new Error(relayJson?.error ? `שליחה נכשלה: ${relayJson.error}` : "שליחת המייל נכשלה");
    }

    const gmailThreadId: string = relayJson.gmailThreadId;
    const gmailMessageId: string | undefined = relayJson.gmailMessageId;

    if (!data.gmail_thread_id) {
      await supabaseAdmin.from("email_threads" as any).upsert({ gmail_thread_id: gmailThreadId, system_id: data.system_id });
    }

    const { error: insertErr } = await supabaseAdmin.from("email_messages" as any).insert({
      system_id: data.system_id,
      direction: "outbound",
      gmail_thread_id: gmailThreadId,
      gmail_message_id: gmailMessageId ?? null,
      agent_id: context.userId,
      agent_name: agentName,
      to_address: data.to,
      subject: data.subject,
      body: data.body,
    });
    if (insertErr) throw new Error(insertErr.message);

    return { ok: true, gmailThreadId };
  });
