-- Admins can now choose the backup frequency (daily/weekly) and time of day
-- under ניהול → גיבויים, instead of the fixed 00:00 UTC daily / Thursday
-- 05:00 UTC weekly times. Since pg_cron itself can't be reconfigured from
-- the app without elevated DB privileges, we replace the two fixed-time
-- jobs with a single heartbeat that fires every 15 minutes and asks the app
-- (via /api/public/hooks/scheduled-backup-check) whether *this* moment
-- matches the admin's configured schedule — see shouldRunScheduledBackup()
-- in src/lib/backups.server.ts for the matching logic.

INSERT INTO public.app_settings (key, value)
VALUES ('backup_schedule', '{"frequency": "daily", "hour": 2, "dayOfWeek": 4}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('backup_schedule_last_run', '{"at": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.run_scheduled_backup_check()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_catalog
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT value ->> 'url' INTO v_url FROM public.app_settings WHERE key = 'backup_webhook_url';
  SELECT value ->> 'secret' INTO v_secret FROM public.app_settings WHERE key = 'backup_webhook_secret';

  IF v_url IS NULL OR btrim(v_url) = '' OR v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'run_scheduled_backup_check(): backup_webhook_url / backup_webhook_secret not configured — skipping. Configure them under ניהול → גיבויים.';
    RETURN;
  END IF;

  SELECT http_post(
    url := rtrim(v_url, '/') || '/api/public/hooks/scheduled-backup-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_secret,
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.run_scheduled_backup_check() FROM PUBLIC, anon, authenticated;

-- Drop the old fixed-time jobs; replace with the 15-minute heartbeat.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('daily-backup-job', 'weekly-backup-job', 'scheduled-backup-heartbeat') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('scheduled-backup-heartbeat', '*/15 * * * *', $$ SELECT private.run_scheduled_backup_check(); $$);
