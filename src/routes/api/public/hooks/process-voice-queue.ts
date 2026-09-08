import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { verifyWebhookAuth } from "@/lib/webhook-auth.server";

/**
 * The self-arming database job authenticates with a token that lives only in
 * a private schema — it is never exposed to the app or the browser. The
 * regular webhook secret keeps working for manual/external calls.
 */
async function cronTokenAccepted(request: Request): Promise<boolean> {
  const token = request.headers.get("x-cron-token") ?? "";
  if (token.length < 32) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("voice_cron_token_valid", { _token: token });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function handleProcessVoiceQueue(request: Request) {
  if (!(await cronTokenAccepted(request))) {
    const unauthorized = verifyWebhookAuth(request);
    if (unauthorized) return unauthorized;
  }
  const limited = await enforcePublicRateLimit(request, "process-voice-queue", 600, 3600);
  if (limited) return limited;
  try {
    const { processPendingVoiceSends } = await import("@/lib/systems.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await processPendingVoiceSends(supabaseAdmin);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const { logger } = await import("@/lib/logger.server");
    logger.error("process-voice-queue failed", { message: e?.message, stack: e?.stack });
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/process-voice-queue")({
  server: {
    handlers: {
      GET: async ({ request }) => handleProcessVoiceQueue(request),
      POST: async ({ request }) => handleProcessVoiceQueue(request),
    },
  },
});
