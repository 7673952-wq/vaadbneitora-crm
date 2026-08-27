import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { timingSafeEqualStr } from "@/lib/webhook-auth.server";

// Relay endpoint for pticha/sgira request emails forwarded by Apps Script.
// Shares the email relay secret with the inbound-email hook.
async function handleSystemRequest(request: Request) {
  const apikey = request.headers.get("apikey") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: secretRow } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "email_relay_secret").maybeSingle();
  const expected = (secretRow?.value as { secret?: string } | null)?.secret || process.env.EMAIL_RELAY_SECRET;

  if (!expected || (!timingSafeEqualStr(apikey, expected) && !timingSafeEqualStr(bearer, expected))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const limited = await enforcePublicRateLimit(request, "system-request", 600, 3600);
  if (limited) return limited;

  try {
    const body = await request.json();
    if (!body?.gmailMessageId) {
      return new Response(JSON.stringify({ ok: false, error: "gmailMessageId required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    const { ingestSystemRequest } = await import("@/lib/system-requests.server");
    const result = await ingestSystemRequest(supabaseAdmin, {
      gmailMessageId: String(body.gmailMessageId),
      gmailThreadId: body.gmailThreadId ?? null,
      subject: body.subject ?? null,
      body: body.body ?? body.text ?? null,
      receivedAt: body.receivedAt ?? null,
      attachmentName: body.attachmentName ?? null,
      attachmentIndex: typeof body.attachmentIndex === "number" ? body.attachmentIndex : null,
    });
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 500, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/system-request")({
  server: { handlers: { POST: ({ request }) => handleSystemRequest(request) } },
});
