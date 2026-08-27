import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";
import { sanitizeText, sanitizeOptional } from "@/lib/sanitize";
import { cleanEmailContent, type EmailCleanupLevel } from "@/lib/email-cleanup";

async function ensureCanWrite(userId: string) {
  const { assertCanWrite } = await import("@/lib/permissions.server");
  await assertCanWrite(userId);
}

// ============= Relay connection settings (Apps Script Web App) =============
const RELAY_URL_KEY = "email_relay_url";
const RELAY_SECRET_KEY = "email_relay_secret";
const RELAY_ADDRESS_KEY = "email_relay_address";
const GENERAL_NAME_KEY = "email_general_name";

export const getEmailRelayConfig = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertAnyPermission } = await import("@/lib/permissions.server");
    await assertAnyPermission(context.userId, ["backup_manage", "settings_manage"]);
    const { data } = await context.supabase
      .from("app_settings").select("key, value").in("key", [RELAY_URL_KEY, RELAY_SECRET_KEY, RELAY_ADDRESS_KEY, GENERAL_NAME_KEY]);
    const get = (k: string) => (data ?? []).find((r: any) => r.key === k)?.value as Record<string, string> | undefined;
    return {
      url: get(RELAY_URL_KEY)?.url ?? "",
      address: get(RELAY_ADDRESS_KEY)?.address ?? "",
      generalName: get(GENERAL_NAME_KEY)?.name ?? "",
      hasSecret: !!get(RELAY_SECRET_KEY)?.secret,
    };
  });

export const setEmailRelayConfig = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { url: string; address: string; generalName?: string; secret?: string }) =>
    z.object({
      url: z.string().max(300).refine((v) => v === "" || /^https:\/\//.test(v), "כתובת חייבת להתחיל ב-https"),
      address: z.string().max(200).refine((v) => v === "" || /.+@.+\..+/.test(v), "כתובת מייל לא תקינה"),
      generalName: z.string().max(200).optional(),
      secret: z.string().max(300).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "backup_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const normalizedUrl = data.url.trim().replace(/\/+$/, "");
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(normalizedUrl)) {
      throw new Error("יש להדביק את כתובת ה-Web App המלאה שמסתיימת ב-/exec");
    }
    const { data: currentSecretRow, error: secretReadError } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", RELAY_SECRET_KEY)
      .maybeSingle();
    if (secretReadError) throw new Error(secretReadError.message);
    const savedSecret = (currentSecretRow?.value as { secret?: string } | null)?.secret?.trim() ?? "";
    const effectiveSecret = data.secret?.trim() || savedSecret;
    if (!effectiveSecret) throw new Error("יש להזין סוד משותף לפני שמירת החיבור");

    // Connection check is diagnostic only — the URL is saved either way so a
    // temporarily broken/old deployment can't block configuration.
    let warning: string | null = null;
    let relayResult: { ok?: boolean; error?: string; version?: number } | null = null;
    try {
      const { postToRelay } = await import("@/lib/relay.server");
      const relayResponse = await postToRelay(normalizedUrl, { action: "ping", secret: effectiveSecret });
      const relayText = (await relayResponse.text().catch(() => "")).trim();
      try { relayResult = JSON.parse(relayText); } catch { /* handled below */ }
      if (relayResult?.error?.toLowerCase() === "unauthorized") {
        warning = "נשמר, אך הסוד ב-Web App הפעיל אינו תואם לסוד במערכת. ב-Apps Script: Deploy → Manage deployments → Edit → New version";
      } else if (!relayResult) {
        warning = /<html|accounts\.google\.com|sign in/i.test(relayText)
          ? "נשמר, אך ה-Web App מחזיר דף התחברות של גוגל. ב-Deploy → Manage deployments יש להגדיר Who has access: Anyone"
          : `נשמר, אך ה-Web App לא החזיר JSON (קוד ${relayResponse.status}). יש לפרוס גרסה חדשה: Deploy → New version${relayText ? ` — ${relayText.slice(0, 120)}` : ""}`;
      } else if (!relayResult.ok) {
        warning = `נשמר, אך בדיקת החיבור נכשלה: ${relayResult.error ?? "שגיאה לא ידועה"}`;
      }
    } catch {
      warning = "נשמר, אך לא ניתן היה להגיע ל-Web App. בדוק שהכתובת מסתיימת ב-/exec ושהגישה מוגדרת ל-Anyone";
    }

    const now = new Date().toISOString();
    const upserts = [
      { key: RELAY_URL_KEY, value: { url: normalizedUrl } },
      { key: RELAY_ADDRESS_KEY, value: { address: data.address.trim() } },
      { key: GENERAL_NAME_KEY, value: { name: data.generalName?.trim() ?? "" } },
    ];
    for (const row of upserts) {
      const { error } = await supabaseAdmin.from("app_settings").upsert({ ...row, updated_at: now, updated_by: context.userId });
      if (error) throw new Error(error.message);
    }
    if (data.secret?.trim()) {
      const { error } = await supabaseAdmin.from("app_settings").upsert({
        key: RELAY_SECRET_KEY, value: { secret: effectiveSecret }, updated_at: now, updated_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    const { data: saved, error: readError } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", RELAY_URL_KEY)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const savedUrl = (saved?.value as { url?: string } | null)?.url;
    if (savedUrl !== normalizedUrl) throw new Error("כתובת ה-Web App לא נשמרה. נסה שוב.");
    return { ok: true, url: savedUrl, relayVersion: relayResult?.version ?? null, warning };
  });

// Lightweight, non-admin-gated: any agent composing an email needs to know
// whether a "general name" option exists, without exposing the rest of the
// relay config (URL/secret) which stays admin-only.
export const getEmailGeneralName = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("app_settings").select("value").eq("key", GENERAL_NAME_KEY).maybeSingle();
    return { generalName: (data?.value as { name?: string } | null)?.name ?? "" };
  });

// ============= Agent display name + signature =============
export const getMyEmailProfile = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles").select("display_name, email_signature" as any).eq("id", context.userId).maybeSingle();
    if (error) throw new Error(error.message);
    return { displayName: (data as any)?.display_name ?? "", signature: (data as any)?.email_signature ?? "" };
  });

export const setMyEmailSignature = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { signature: string }) => z.object({ signature: z.string().max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles" as any).update({ email_signature: sanitizeOptional(data.signature) ?? "" }).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Templates =============
export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("email_templates" as any).select("*").order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { id?: string; name: string; subject: string; body: string }) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(200),
      subject: z.string().max(300),
      body: z.string().max(5000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "settings_manage");
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
  .middleware([requireAuthMfa])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "settings_manage");
    const { error } = await context.supabase.from("email_templates" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Admin: per-agent email display name override =============
// Lets an admin decide what name each agent's outgoing mail shows as,
// regardless of their regular in-app display_name.
export const listAgentEmailNames = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles").select("id, display_name, email_display_name" as any).order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { id: string; display_name: string; email_display_name: string | null }[];
  });

export const setAgentEmailDisplayName = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { user_id: string; email_display_name: string }) =>
    z.object({ user_id: z.string().uuid(), email_display_name: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "users_manage");
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
  .middleware([requireAuthMfa])
  .inputValidator((d: { system_id: string }) => z.object({ system_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("email_messages" as any).select("*").eq("system_id", data.system_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listRecordEmailThread = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { record_id: string }) => z.object({ record_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: record } = await context.supabase.from("crm_records").select("crm_key").eq("id", data.record_id).maybeSingle();
    if (!record) throw new Error("הפניה לא נמצאה");
    const { assertCrmAccess } = await import("@/lib/permissions.server");
    await assertCrmAccess(context.userId, (record as any).crm_key);
    const { data: rows, error } = await context.supabase.from("email_messages" as any).select("*").eq("crm_record_id", data.record_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============= Send / reply =============
export const sendSystemEmail = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { system_id: string; to: string; subject: string; body: string; gmail_thread_id?: string | null; use_general_name?: boolean; cleanup_level?: EmailCleanupLevel }) =>
    z.object({
      system_id: z.string().uuid(),
      to: z.string().email(),
      subject: z.string().max(300),
      body: z.string().min(1).max(20000),
      gmail_thread_id: z.string().nullable().optional(),
      use_general_name: z.boolean().optional(),
      cleanup_level: z.enum(["none", "light", "standard", "strict"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "emails_send");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: relayUrlRow }, { data: relaySecretRow }, { data: profileRow }, { data: generalNameRow }] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_URL_KEY).maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_SECRET_KEY).maybeSingle(),
      supabaseAdmin.from("profiles").select("display_name, email_signature, email_display_name" as any).eq("id", context.userId).maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_general_name").maybeSingle(),
    ]);
    const relayUrl = (relayUrlRow?.value as { url?: string } | null)?.url;
    const relaySecret = (relaySecretRow?.value as { secret?: string } | null)?.secret;
    if (!relayUrl || !relaySecret) {
      throw new Error("שליחת מייל לא מוגדרת עדיין — יש להגדיר את חיבור Gmail תחת ניהול → מיילים");
    }
    const personalName = (profileRow as any)?.email_display_name || (profileRow as any)?.display_name || "נציג";
    const generalName = (generalNameRow?.value as { name?: string } | null)?.name || "";
    const agentName = (data.use_general_name && generalName) ? generalName : personalName;
    const agentSignature = (profileRow as any)?.email_signature || "";

    const { getGmailLabelRouting } = await import("@/lib/mail-label.server");
    const gmailRouting = await getGmailLabelRouting();
    const cleanedBody = cleanEmailContent(data.body, data.cleanup_level ?? "standard");
    if (!cleanedBody) throw new Error("תוכן המייל ריק לאחר הניקוי");
    const relayPayload = data.gmail_thread_id
      ? { secret: relaySecret, action: "reply", gmailThreadId: data.gmail_thread_id, to: data.to, body: cleanedBody, agentName, agentSignature, label: gmailRouting.label, archive: gmailRouting.archive }
      : { secret: relaySecret, action: "send", to: data.to, subject: data.subject, body: cleanedBody, agentName, agentSignature, label: gmailRouting.label, archive: gmailRouting.archive };

    let relayRes: Response;
    try {
      const { postToRelay } = await import("@/lib/relay.server");
      relayRes = await postToRelay(relayUrl, relayPayload);
    } catch {
      throw new Error("לא ניתן להתחבר לשרת השליחה (Apps Script) — בדוק את הכתובת בהגדרות");
    }
    const relayJson: any = await relayRes.json().catch(() => ({}));
    if (!relayRes.ok || !relayJson?.ok) {
      throw new Error(relayJson?.error ? `שליחה נכשלה: ${relayJson.error}` : "שליחת המייל נכשלה");
    }

    const gmailThreadId: string = relayJson.gmailThreadId;
    const gmailMessageId: string | undefined = relayJson.gmailMessageId;

    // Always upsert with whatever thread id the relay actually returned —
    // on the fallback path (customer hasn't replied yet on this thread) the
    // relay may open a fresh Gmail thread, and later messages need to group
    // under that new id, not the stale one.
    await supabaseAdmin.from("email_threads" as any).upsert({ gmail_thread_id: gmailThreadId, system_id: data.system_id });

    const { error: insertErr } = await supabaseAdmin.from("email_messages" as any).insert({
      system_id: data.system_id,
      direction: "outbound",
      gmail_thread_id: gmailThreadId,
      gmail_message_id: gmailMessageId ?? null,
      agent_id: context.userId,
      agent_name: agentName,
      to_address: data.to,
      subject: data.subject,
       body: cleanedBody,
    });
    if (insertErr) throw new Error(insertErr.message);

    return { ok: true, gmailThreadId };
  });

export const sendRecordEmail = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { record_id: string; to: string; subject: string; body: string; gmail_thread_id?: string | null; cleanup_level?: EmailCleanupLevel }) => z.object({
    record_id: z.string().uuid(), to: z.string().email(), subject: z.string().max(300), body: z.string().min(1).max(20000), gmail_thread_id: z.string().nullable().optional(), cleanup_level: z.enum(["none", "light", "standard", "strict"]).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: record } = await supabaseAdmin.from("crm_records").select("crm_key").eq("id", data.record_id).maybeSingle();
    if (!record) throw new Error("הפניה לא נמצאה");
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "emails_send", (record as any).crm_key);
    const [{ data: urlRow }, { data: secretRow }, { data: profile }] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_URL_KEY).maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_SECRET_KEY).maybeSingle(),
      supabaseAdmin.from("profiles").select("display_name, email_signature, email_display_name" as any).eq("id", context.userId).maybeSingle(),
    ]);
    const relayUrl = (urlRow?.value as any)?.url;
    const relaySecret = (secretRow?.value as any)?.secret;
    if (!relayUrl || !relaySecret) throw new Error("שליחת מייל לא מוגדרת עדיין");
    const agentName = (profile as any)?.email_display_name || (profile as any)?.display_name || "נציג";
    const { getGmailLabelRouting } = await import("@/lib/mail-label.server");
    const gmailRouting = await getGmailLabelRouting();
    const cleanedBody = cleanEmailContent(data.body, data.cleanup_level ?? "standard");
    if (!cleanedBody) throw new Error("תוכן המייל ריק לאחר הניקוי");
    const payload = data.gmail_thread_id
      ? { secret: relaySecret, action: "reply", gmailThreadId: data.gmail_thread_id, to: data.to, body: cleanedBody, agentName, agentSignature: (profile as any)?.email_signature || "", label: gmailRouting.label, archive: gmailRouting.archive }
      : { secret: relaySecret, action: "send", to: data.to, subject: data.subject, body: cleanedBody, agentName, agentSignature: (profile as any)?.email_signature || "", label: gmailRouting.label, archive: gmailRouting.archive };
    const { postToRelay } = await import("@/lib/relay.server");
    const response = await postToRelay(relayUrl, payload);
    const result: any = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) throw new Error(result?.error || "שליחת המייל נכשלה");
    // Always upsert with the returned thread id (see comment in sendSystemEmail).
    await supabaseAdmin.from("email_threads" as any).upsert({ gmail_thread_id: result.gmailThreadId, crm_record_id: data.record_id });
    const { error } = await supabaseAdmin.from("email_messages" as any).insert({ crm_record_id: data.record_id, direction: "outbound", gmail_thread_id: result.gmailThreadId, gmail_message_id: result.gmailMessageId ?? null, agent_id: context.userId, agent_name: agentName, to_address: data.to, subject: data.subject, body: cleanedBody });
    if (error) throw new Error(error.message);
    return { ok: true, gmailThreadId: result.gmailThreadId as string };
  });
