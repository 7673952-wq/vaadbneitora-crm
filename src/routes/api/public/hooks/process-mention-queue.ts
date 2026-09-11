import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { verifyWebhookAuth } from "@/lib/webhook-auth.server";

/**
 * Mirrors process-voice-queue.ts: the self-arming DB job authenticates with
 * a private-schema token; the regular webhook secret keeps working for
 * manual/external calls.
 */
async function cronTokenAccepted(request: Request): Promise<boolean> {
  const token = request.headers.get("x-cron-token") ?? "";
  if (token.length < 32) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("cron_token_valid", { _name: "mention_queue", _token: token });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function handleProcessMentionQueue(request: Request) {
  if (!(await cronTokenAccepted(request))) {
    const unauthorized = verifyWebhookAuth(request);
    if (unauthorized) return unauthorized;
  }
  const limited = await enforcePublicRateLimit(request, "process-mention-queue", 600, 3600);
  if (limited) return limited;
  try {
    const { processMentionQueue } = await import("@/lib/mentions.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await processMentionQueue(supabaseAdmin);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const { logger } = await import("@/lib/logger.server");
    logger.error("process-mention-queue failed", { message: e?.message, stack: e?.stack });
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/process-mention-queue")({
  server: {
    handlers: {
      GET: async () => new Response(JSON.stringify({ ok: true, queue: "mention" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      POST: async ({ request }) => handleProcessMentionQueue(request),
    },
  },
});
