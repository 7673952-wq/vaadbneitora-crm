import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { verifyWebhookAuth } from "@/lib/webhook-auth.server";

async function handleWeeklyBackup(request: Request) {
  const unauthorized = verifyWebhookAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const { runBackup, sendBackupEmail } = await import("@/lib/backups.server");
    const result = await runBackup();
    const emailStatus = await sendBackupEmail(result, "weekly");
    return new Response(JSON.stringify({ ok: true, ...result, emailStatus }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const { logger } = await import("@/lib/logger.server");
    logger.error("weekly-backup failed", { message: e?.message, stack: e?.stack });
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/weekly-backup")({
  server: {
    handlers: {
      GET: async ({ request }) => handleWeeklyBackup(request),
      POST: async ({ request }) => handleWeeklyBackup(request),
    },
  },
});
