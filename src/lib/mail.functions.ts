import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fromSupabase } from "@/lib/errors";
import { cleanEmailContent, type EmailCleanupLevel } from "@/lib/email-cleanup";
import { parseMailboxPrefs, type MailboxPrefs } from "@/lib/mailbox-prefs";
import { parseEmailAddress } from "@/lib/email-address";

export type MailThread = {
  threadId: string;
  address: string;
  /** Human name of the other side of the conversation ("דנה לוי"). */
  displayName: string;
  subject: string | null;
  snippet: string;
  lastAt: string;
  count: number;
  unread: number;
  lastDirection: string;
  systemId: string | null;
  recordId: string | null;
};

export type MailMessage = {
  id: string;
  threadId: string | null;
  systemId: string | null;
  recordId: string | null;
  direction: string;
  subject: string | null;
  body: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  toName: string | null;
  agentName: string | null;
  readAt: string | null;
  createdAt: string;
};

export type MailContact = {
  email: string;
  name: string;
  messages: number;
  lastAt: string;
  systemId: string | null;
  recordId: string | null;
};


/** Mailbox: conversations grouped by Gmail thread, across the whole CRM. */
export const listMailThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().max(120).optional(),
        filter: z.enum(["all", "unread", "inbox", "sent"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<MailThread[]> => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "mailbox_view");
    const { data: rows, error } = await context.supabase
      .from("email_messages")
      .select("id, system_id, crm_record_id, direction, subject, body, from_address, to_address, gmail_thread_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw fromSupabase(error);

    const isInbound = (d: string) => d === "in" || d === "inbound";
    const map = new Map<string, MailThread>();
    for (const m of (rows ?? []) as any[]) {
      const key = m.gmail_thread_id || `msg:${m.id}`;
      const parsed = parseEmailAddress(isInbound(m.direction) ? m.from_address : m.to_address);
      const addr = parsed.email;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (isInbound(m.direction) && !m.read_at) existing.unread += 1;
        if (!existing.address && addr) { existing.address = addr; existing.displayName = parsed.name; }
        if (!existing.subject && m.subject) existing.subject = m.subject;
        if (!existing.systemId && m.system_id) existing.systemId = m.system_id;
        if (!existing.recordId && m.crm_record_id) existing.recordId = m.crm_record_id;
      } else {
        map.set(key, {
          threadId: key,
          address: addr,
          displayName: parsed.name,
          subject: m.subject ?? null,
          snippet: String(m.body ?? "").replace(/\s+/g, " ").slice(0, 120),
          lastAt: m.created_at,
          count: 1,
          unread: isInbound(m.direction) && !m.read_at ? 1 : 0,
          lastDirection: m.direction,
          systemId: m.system_id ?? null,
          recordId: m.crm_record_id ?? null,
        });
      }
    }

    let list = [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    const filter = data.filter ?? "all";
    if (filter === "unread") list = list.filter((t) => t.unread > 0);
    if (filter === "inbox") list = list.filter((t) => t.lastDirection === "in" || t.lastDirection === "inbound");
    if (filter === "sent") list = list.filter((t) => t.lastDirection === "out" || t.lastDirection === "outbound");
    const q = data.search?.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.address, t.displayName, t.subject ?? "", t.snippet].join(" ").toLowerCase().includes(q),
      );
    }
    return list.slice(0, 300);
  });

/** Contact book built from every address the CRM has corresponded with. */
export const listMailContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ search: z.string().max(120).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<MailContact[]> => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "mailbox_view");
    const { data: rows, error } = await context.supabase
      .from("email_messages")
      .select("direction, from_address, to_address, system_id, crm_record_id, created_at")
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) throw fromSupabase(error);

    const isInbound = (d: string) => d === "in" || d === "inbound";
    const map = new Map<string, MailContact>();
    for (const m of (rows ?? []) as any[]) {
      const parsed = parseEmailAddress(isInbound(m.direction) ? m.from_address : m.to_address);
      if (!parsed.email) continue;
      const existing = map.get(parsed.email);
      if (existing) {
        existing.messages += 1;
        if (!existing.systemId && m.system_id) existing.systemId = m.system_id;
        if (!existing.recordId && m.crm_record_id) existing.recordId = m.crm_record_id;
        if (existing.lastAt < m.created_at) existing.lastAt = m.created_at;
      } else {
        map.set(parsed.email, {
          email: parsed.email,
          name: parsed.name,
          messages: 1,
          lastAt: m.created_at,
          systemId: m.system_id ?? null,
          recordId: m.crm_record_id ?? null,
        });
      }
    }
    let list = [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    const q = data.search?.trim().toLowerCase();
    if (q) list = list.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q));
    return list.slice(0, 500);
  });


/** All messages in one conversation. */
export const getMailThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ threadId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }): Promise<MailMessage[]> => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "mailbox_view");
    const single = data.threadId.startsWith("msg:");
    const query = context.supabase
      .from("email_messages")
      .select("id, system_id, crm_record_id, direction, subject, body, from_address, to_address, agent_name, gmail_thread_id, read_at, created_at")
      .order("created_at", { ascending: true })
      .limit(300);
    const { data: rows, error } = single
      ? await query.eq("id", data.threadId.slice(4))
      : await query.eq("gmail_thread_id", data.threadId);
    if (error) throw fromSupabase(error);
    return (rows ?? []).map((m: any) => ({
      id: m.id,
      threadId: m.gmail_thread_id ?? null,
      systemId: m.system_id ?? null,
      recordId: m.crm_record_id ?? null,
      direction: m.direction,
      subject: m.subject ?? null,
      body: m.body ?? "",
      fromAddress: m.from_address ?? null,
      toAddress: m.to_address ?? null,
      agentName: m.agent_name ?? null,
      readAt: m.read_at ?? null,
      createdAt: m.created_at,
    }));
  });

/** Marks every inbound message in a conversation as read. */
export const markMailThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ threadId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("email_messages")
      .update({ read_at: now })
      .eq("gmail_thread_id", data.threadId)
      .is("read_at", null);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

/**
 * Sends a standalone mailbox message (new conversation or reply) through the
 * Gmail relay, exactly like the per-system mail — but without needing a card.
 */
export const sendMailboxMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        to: z.string().email(),
        subject: z.string().max(300).optional(),
        body: z.string().min(1).max(20000),
        threadId: z.string().max(200).nullable().optional(),
        useGeneralName: z.boolean().optional(),
        cleanupLevel: z.enum(["none", "light", "standard", "strict"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "emails_send");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: urlRow }, { data: secretRow }, { data: profile }, { data: generalRow }] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_url").maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_secret").maybeSingle(),
      supabaseAdmin.from("profiles").select("display_name, email_signature, email_display_name" as any).eq("id", context.userId).maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", "email_general_name").maybeSingle(),
    ]);
    const relayUrl = (urlRow?.value as { url?: string } | null)?.url;
    const relaySecret = (secretRow?.value as { secret?: string } | null)?.secret;
    if (!relayUrl || !relaySecret) {
      throw new Error("שליחת מייל לא מוגדרת עדיין — יש להגדיר את חיבור Gmail תחת ניהול → מיילים");
    }
    const personalName = (profile as any)?.email_display_name || (profile as any)?.display_name || "נציג";
    const generalName = (generalRow?.value as { name?: string } | null)?.name || "";
    const agentName = data.useGeneralName && generalName ? generalName : personalName;
    const agentSignature = (profile as any)?.email_signature || "";

    const { getGmailLabelRouting } = await import("@/lib/mail-label.server");
    const gmailRouting = await getGmailLabelRouting();
    const cleanedBody = cleanEmailContent(data.body, (data.cleanupLevel ?? "standard") as EmailCleanupLevel);
    if (!cleanedBody) throw new Error("תוכן המייל ריק לאחר הניקוי");

    const threadId = data.threadId && !data.threadId.startsWith("msg:") ? data.threadId : null;
    const payload = threadId
      ? { secret: relaySecret, action: "reply", gmailThreadId: threadId, body: cleanedBody, agentName, agentSignature, label: gmailRouting.label, archive: gmailRouting.archive }
      : { secret: relaySecret, action: "send", to: data.to, subject: data.subject ?? "", body: cleanedBody, agentName, agentSignature, label: gmailRouting.label, archive: gmailRouting.archive };

    let res: Response;
    try {
      const { postToRelay } = await import("@/lib/relay.server");
      res = await postToRelay(relayUrl, payload);
    } catch {
      throw new Error("לא ניתן להתחבר לשרת השליחה (Apps Script) — בדוק את הכתובת בהגדרות");
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error ? `שליחה נכשלה: ${json.error}` : "שליחת המייל נכשלה");

    const gmailThreadId: string = json.gmailThreadId;
    if (!threadId) {
      await supabaseAdmin.from("email_threads" as any).upsert({ gmail_thread_id: gmailThreadId });
    }
    const { error } = await supabaseAdmin.from("email_messages" as any).insert({
      direction: "outbound",
      gmail_thread_id: gmailThreadId,
      gmail_message_id: json.gmailMessageId ?? null,
      agent_id: context.userId,
      agent_name: agentName,
      to_address: data.to,
      subject: data.subject ?? null,
      body: cleanedBody,
      read_at: new Date().toISOString(),
    });
    if (error) throw fromSupabase(error);
    return { ok: true, threadId: gmailThreadId };
  });

// ============= Mailbox preferences (managed in ניהול → תיבת דואר) =============

export const getMailboxPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MailboxPrefs> => {
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", "mailbox_prefs").maybeSingle();
    return parseMailboxPrefs(data?.value);
  });

export const setMailboxPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        defaultCleanupLevel: z.enum(["none", "light", "standard", "strict"]),
        defaultUseGeneralName: z.boolean(),
        refreshSeconds: z.number().int().min(0).max(3600),
        defaultFilter: z.enum(["all", "unread", "inbox", "sent"]),
        allowPersonalSignature: z.boolean(),
        gmailLabel: z.string().max(100),
        gmailArchive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: "mailbox_prefs",
      value: data,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

/** Everything the mailbox UI needs to know about the current setup. */
export const getMailboxSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["email_relay_url", "email_relay_address", "email_general_name", "mailbox_prefs"]);
    const get = (k: string) => (data ?? []).find((r: any) => r.key === k)?.value as Record<string, string> | undefined;
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("display_name, email_signature, email_display_name" as any)
      .eq("id", context.userId)
      .maybeSingle();
    return {
      configured: !!get("email_relay_url")?.url,
      address: get("email_relay_address")?.address ?? "",
      generalName: get("email_general_name")?.name ?? "",
      myName: (profile as any)?.email_display_name || (profile as any)?.display_name || "",
      signature: (profile as any)?.email_signature ?? "",
      prefs: parseMailboxPrefs((data ?? []).find((r: any) => r.key === "mailbox_prefs")?.value),
    };
  });

