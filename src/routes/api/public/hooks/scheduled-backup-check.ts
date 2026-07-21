import { createFileRoute } from "@tanstack/react-router";

// Called every 15 minutes by pg_cron (see
// supabase/migrations/*_backup_schedule_config.sql). Unlike the old fixed
// daily/weekly cron times, this reads the admin-configured frequency + hour
// (+ day of week, for weekly) from app_settings.backup_schedule and only
// actually performs a backup when the current time matches — see
// shouldRunScheduledBackup() in backups.server.ts for the matching logic.
const SCHEDULE_KEY = "backup_schedule";
const LAST_RUN_KEY = "backup_schedule_last_run";

async function handleScheduledBackupCheck(request: Request) {
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { shouldRunScheduledBackup, runBackup, sendBackupEmail } = await import("@/lib/backups.server");

    const [{ data: scheduleRow }, { data: lastRunRow }] = await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", SCHEDULE_KEY).maybeSingle(),
      supabaseAdmin.from("app_settings").select("value").eq("key", LAST_RUN_KEY).maybeSingle(),
    ]);
    const scheduleValue = (scheduleRow?.value as { frequency?: string; hour?: number; dayOfWeek?: number } | null) ?? null;
    const schedule = {
      frequency: scheduleValue?.frequency === "weekly" ? "weekly" as const : "daily" as const,
      hour: typeof scheduleValue?.hour === "number" ? scheduleValue.hour : 2,
      dayOfWeek: typeof scheduleValue?.dayOfWeek === "number" ? scheduleValue.dayOfWeek : 4,
    };
    const lastRunAt = ((lastRunRow?.value as { at?: string } | null)?.at) ?? null;

    const { run, kind } = shouldRunScheduledBackup(schedule, lastRunAt);
    if (!run) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await runBackup();
    const emailStatus = await sendBackupEmail(result, kind);
    await supabaseAdmin.from("app_settings").upsert({
      key: LAST_RUN_KEY,
      value: { at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ ok: true, ran: true, kind, ...result, emailStatus }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const { logger } = await import("@/lib/logger.server");
    logger.error("scheduled-backup-check failed", { message: e?.message, stack: e?.stack });
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/scheduled-backup-check")({
  server: {
    handlers: {
      GET: async ({ request }) => handleScheduledBackupCheck(request),
      POST: async ({ request }) => handleScheduledBackupCheck(request),
    },
  },
});
