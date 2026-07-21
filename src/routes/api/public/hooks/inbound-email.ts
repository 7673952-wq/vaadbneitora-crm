import { createFileRoute } from "@tanstack/react-router";

async function handleInboundEmail(request: Request) {
  const apikey = request.headers.get("apikey");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: secretRow } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "email_relay_secret").maybeSingle();
  const expected = (secretRow?.value as { secret?: string } | null)?.secret || process.env.EMAIL_RELAY_SECRET;

  if (!expected || (apikey !== expected && bearer !== expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { gmailThreadId, gmailMessageId, from, to, subject, body: text, receivedAt } = body ?? {};
    if (!gmailThreadId) {
      return new Response(JSON.stringify({ ok: false, error: "gmailThreadId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Resolve which system this thread belongs to — set once when the CRM
    // first sent a message on this thread (see sendSystemEmail).
    const { data: threadRow } = await supabaseAdmin
      .from("email_threads" as any)
      .select("system_id")
      .eq("gmail_thread_id", gmailThreadId)
      .maybeSingle();

    if (!threadRow) {
      // Not a thread the CRM started/knows about — ignore silently so an
      // unrelated reply in the shared mailbox doesn't error the webhook.
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Avoid double-inserting if Apps Script retries the same message.
    const { data: existing } = await supabaseAdmin
      .from("email_messages" as any)
      .select("id")
      .eq("gmail_message_id", gmailMessageId ?? "")
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const receivedIso = receivedAt ?? new Date().toISOString();
    const systemId = (threadRow as any).system_id as string;

    const { error } = await supabaseAdmin.from("email_messages" as any).insert({
      system_id: systemId,
      direction: "inbound",
      gmail_thread_id: gmailThreadId,
      gmail_message_id: gmailMessageId ?? null,
      from_address: from ?? null,
      to_address: to ?? null,
      subject: subject ?? null,
      body: text ?? "",
      created_at: receivedIso,
    });
    if (error) throw error;

    // Flag the system so the dashboard shows an "unread email" badge, and
    // optionally re-open it into an unhandled status (configured in admin).
    const patch: Record<string, unknown> = {
      has_unread_email: true,
      last_inbound_email_at: receivedIso,
      updated_at: receivedIso,
    };
    const { data: statusCfg } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "unhandled_email_status_key").maybeSingle();
    const nextStatus = (statusCfg?.value as { status_key?: string } | null)?.status_key?.trim();
    if (nextStatus) patch.status = nextStatus;
    await supabaseAdmin.from("systems").update(patch).eq("id", systemId);


    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const { logger } = await import("@/lib/logger.server");
    logger.error("inbound-email failed", { message: e?.message, stack: e?.stack });
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/inbound-email")({
  server: {
    handlers: {
      POST: async ({ request }) => handleInboundEmail(request),
    },
  },
});
