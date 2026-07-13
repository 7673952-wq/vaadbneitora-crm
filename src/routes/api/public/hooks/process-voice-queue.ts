import { createFileRoute } from "@tanstack/react-router";

async function handleProcessVoiceQueue(request: Request) {
  const apikey = request.headers.get("apikey");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.BACKUP_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!expected || (apikey !== expected && bearer !== expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
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
