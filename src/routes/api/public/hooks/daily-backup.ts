import { createFileRoute } from "@tanstack/react-router";

async function handleDailyBackup(request: Request) {
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
    const { runBackup, sendBackupEmail } = await import("@/lib/backups.server");
    const result = await runBackup();
    const emailStatus = await sendBackupEmail(result, "daily");
    return new Response(JSON.stringify({ ok: true, ...result, emailStatus }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const { logger } = await import("@/lib/logger.server");
    logger.error("daily-backup failed", { message: e?.message, stack: e?.stack });
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/daily-backup")({
  server: {
    handlers: {
      GET: async ({ request }) => handleDailyBackup(request),
      POST: async ({ request }) => handleDailyBackup(request),
    },
  },
});
