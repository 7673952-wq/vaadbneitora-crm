import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { timingSafeEqualStr } from "@/lib/webhook-auth.server";

async function handleInboundEmail(request: Request) {
  const apikey = request.headers.get("apikey") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: secretRow } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "email_relay_secret").maybeSingle();
  const expected = (secretRow?.value as { secret?: string } | null)?.secret || process.env.EMAIL_RELAY_SECRET;

  if (!expected || (!timingSafeEqualStr(apikey, expected) && !timingSafeEqualStr(bearer, expected))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { gmailThreadId, gmailMessageId, from, to, subject, body: text, receivedAt } = body ?? {};
    if (!gmailThreadId || !gmailMessageId) {
      return new Response(JSON.stringify({ ok: false, error: "gmailThreadId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Resolve which system this thread belongs to — set once when the CRM
    // first sent a message on this thread (see sendSystemEmail).
    const { data: threadRow } = await supabaseAdmin
      .from("email_threads" as any)
      .select("system_id, crm_record_id")
      .eq("gmail_thread_id", gmailThreadId)
      .maybeSingle();

    if (!threadRow) {
      // Unknown thread belongs to the shared mailbox. Keep a lightweight
      // thread record so later replies and outbound messages group reliably.
      const { error: threadError } = await supabaseAdmin
        .from("email_threads" as any)
        .upsert({ gmail_thread_id: gmailThreadId }, { onConflict: "gmail_thread_id" });
      if (threadError) throw threadError;
    }


    // Avoid double-inserting if Apps Script retries the same message.
    const { data: existing } = await supabaseAdmin
      .from("email_messages" as any)
      .select("id, direction, system_id, crm_record_id")
      .eq("gmail_message_id", gmailMessageId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      const existingMessage = existing as any;
      // The relay is the authoritative source for Gmail direction/address data.
      // Reconcile rows previously created by the CRM or an older relay version
      // instead of returning early with stale "inbound/outbound" classification.
      const stated = String(body?.direction ?? "").toLowerCase();
      const reconciledDirection = stated === "outbound" || stated === "out"
        ? "outbound"
        : stated === "inbound" || stated === "in"
          ? "inbound"
          : existingMessage.direction;
      const { error: reconcileError } = await supabaseAdmin
        .from("email_messages" as any)
        .update({
          direction: reconciledDirection,
          from_address: from ?? null,
          to_address: to ?? null,
          subject: subject ?? null,
        })
        .eq("id", existingMessage.id);
      if (reconcileError) throw reconcileError;
      return new Response(JSON.stringify({ ok: true, duplicate: true, messageId: gmailMessageId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const receivedIso = receivedAt ?? new Date().toISOString();
    let systemId = ((threadRow as any)?.system_id ?? null) as string | null;
    let recordId = ((threadRow as any)?.crm_record_id ?? null) as string | null;

    // Direction: the relay may state it explicitly; otherwise infer it by
    // comparing the sender with the CRM's own mailbox address.
    const { data: addrRow } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "email_relay_address").maybeSingle();
    const myAddress = ((addrRow?.value as { address?: string } | null)?.address ?? "").trim().toLowerCase();
    const fromLower = String(from ?? "").toLowerCase();
    const stated = String(body?.direction ?? "").toLowerCase();
    const direction =
      stated === "outbound" || stated === "out"
        ? "outbound"
        : stated === "inbound" || stated === "in"
          ? "inbound"
          : myAddress && fromLower.includes(myAddress)
            ? "outbound"
            : "inbound";
    const isInbound = direction === "inbound";

    // Older relay versions created Gmail thread rows without a card mapping.
    // Recover that mapping from the correspondent's address when it identifies
    // exactly one system/record, so replies appear inside the originating card.
    if (!systemId && !recordId) {
      const correspondent = String(isInbound ? from : to).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? "";
      if (correspondent) {
        const [{ data: systems }, { data: records }] = await Promise.all([
          supabaseAdmin.from("systems").select("id").ilike("email", correspondent).limit(2),
          supabaseAdmin.from("crm_records").select("id").ilike("email", correspondent).limit(2),
        ]);
        if ((systems?.length ?? 0) === 1) systemId = systems?.[0]?.id ?? null;
        if (!systemId && (records?.length ?? 0) === 1) recordId = records?.[0]?.id ?? null;
        if (systemId || recordId) {
          const { error: mappingError } = await supabaseAdmin
            .from("email_threads" as any)
            .upsert({ gmail_thread_id: gmailThreadId, system_id: systemId, crm_record_id: recordId }, { onConflict: "gmail_thread_id" });
          if (mappingError) throw mappingError;
        }
      }
    }

    const { stripQuotedEmail } = await import("@/lib/email-cleanup");

    const { error } = await supabaseAdmin.from("email_messages" as any).insert({
      system_id: systemId,
      crm_record_id: recordId,
      direction,
      gmail_thread_id: gmailThreadId,
      gmail_message_id: gmailMessageId,
      from_address: from ?? null,
      to_address: to ?? null,
      subject: subject ?? null,
      body: stripQuotedEmail(text ?? ""),
      read_at: isInbound ? null : receivedIso,
      created_at: receivedIso,
    });
    if (error) throw error;

    if (!isInbound) {
      return new Response(JSON.stringify({ ok: true, direction }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Flag the system so the dashboard shows an "unread email" badge, and
    // optionally re-open it into an unhandled status (configured in admin).
    const patch: any = {
      has_unread_email: true,
      last_inbound_email_at: receivedIso,
      updated_at: receivedIso,
    };
    const { data: statusCfg } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "unhandled_email_status_key").maybeSingle();
    const nextStatus = (statusCfg?.value as { status_key?: string } | null)?.status_key?.trim();
    if (nextStatus) patch.status = nextStatus;
    if (systemId) await supabaseAdmin.from("systems").update(patch).eq("id", systemId);
    if (recordId) await supabaseAdmin.from("crm_records").update({ reminder_at: receivedIso, updated_at: receivedIso }).eq("id", recordId);



    return new Response(JSON.stringify({ ok: true, inserted: true, messageId: gmailMessageId, direction }), {
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
