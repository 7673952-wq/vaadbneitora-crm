import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { verifyWebhookAuth } from "@/lib/webhook-auth.server";

// Called every 15 minutes by pg_cron (see
// supabase/migrations/*_backup_schedule_config.sql). Unlike the old fixed
// daily/weekly cron times, this reads the admin-configured frequency + hour
// (+ day of week, for weekly) from app_settings.backup_schedule and only
// actually performs a backup when the current time matches — see
// shouldRunScheduledBackup() in backups.server.ts for the matching logic.
const SCHEDULE_KEY = "backup_schedule";
const LAST_RUN_KEY = "backup_schedule_last_run";

async function handleScheduledBackupCheck(request: Request) {
  const unauthorized = verifyWebhookAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { shouldRunScheduledBackup, runBackup, sendBackupEmail, pruneOldBackups, DEFAULT_BACKUP_RETENTION } =
      await import("@/lib/backups.server");

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
    const rv = scheduleValue as { retentionDailyDays?: number; retentionWeeklyDays?: number } | null;
    const retention = {
      dailyDays: typeof rv?.retentionDailyDays === "number" ? rv.retentionDailyDays : DEFAULT_BACKUP_RETENTION.dailyDays,
      weeklyDays: typeof rv?.retentionWeeklyDays === "number" ? rv.retentionWeeklyDays : DEFAULT_BACKUP_RETENTION.weeklyDays,
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
    // Retention cleanup runs right after a successful backup, so old folders
    // (including their copied storage files) don't grow without bound.
    let pruned: unknown = null;
    if (retention.dailyDays > 0 && retention.weeklyDays > 0) {
      try { pruned = await pruneOldBackups(retention); }
      catch (e: any) { pruned = { error: e?.message ?? "prune failed" }; }
    }
    await supabaseAdmin.from("app_settings").upsert({
      key: LAST_RUN_KEY,
      value: { at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ ok: true, ran: true, kind, ...result, emailStatus, pruned }), {
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
