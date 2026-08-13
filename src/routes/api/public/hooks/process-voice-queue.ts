import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { verifyWebhookAuth } from "@/lib/webhook-auth.server";

async function handleProcessVoiceQueue(request: Request) {
  const unauthorized = verifyWebhookAuth(request);
  if (unauthorized) return unauthorized;
  const limited = await enforcePublicRateLimit(request, "process-voice-queue", 60, 3600);
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
