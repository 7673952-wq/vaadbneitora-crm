-- Automatic (Thursday weekly + nightly) backups were previously driven only
-- by vercel.json "crons", which only fire when the app is actually deployed
-- on Vercel. When deployed elsewhere (e.g. Lovable Cloud / self-hosted
-- Docker) those crons never run, so only the manual "גיבוי עכשיו" button
-- worked. This migration schedules the same webhooks directly from
-- Postgres via pg_cron + pg_net, which works no matter where the app is
-- hosted, as long as it's reachable at the configured URL.
--
-- Setup required (once, by an admin): fill in "כתובת אתר לגיבוי אוטומטי"
-- and "סוד webhook לגיבוי" under ניהול → גיבויים. The secret must match the
-- BACKUP_WEBHOOK_SECRET (or CRON_SECRET) environment variable configured
-- on the server.

CREATE SCHEMA IF NOT EXISTS cron;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Placeholder settings rows (admin fills in the real values from the UI).
INSERT INTO public.app_settings (key, value)
VALUES ('backup_webhook_url', '{"url": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('backup_webhook_secret', '{"secret": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.run_scheduled_backup(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_catalog
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_path text;
  v_request_id bigint;
BEGIN
  SELECT value ->> 'url' INTO v_url FROM public.app_settings WHERE key = 'backup_webhook_url';
  SELECT value ->> 'secret' INTO v_secret FROM public.app_settings WHERE key = 'backup_webhook_secret';

  IF v_url IS NULL OR btrim(v_url) = '' OR v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'run_scheduled_backup(%): backup_webhook_url / backup_webhook_secret not configured — skipping. Configure them under ניהול → גיבויים.', p_kind;
    RETURN;
  END IF;

  v_path := CASE WHEN p_kind = 'weekly' THEN '/api/public/hooks/weekly-backup' ELSE '/api/public/hooks/daily-backup' END;

  -- Fire-and-forget async HTTP call via pg_net; the webhook itself performs
  -- the backup + (for weekly) the email send. We don't wait on the response
  -- here — pg_net queues the request and records the result in net._http_response.
  SELECT http_post(
    url := rtrim(v_url, '/') || v_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_secret,
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  ) INTO v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.run_scheduled_backup(text) FROM PUBLIC, anon, authenticated;

-- Re-runnable: drop any previously scheduled jobs with these names first.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('daily-backup-job', 'weekly-backup-job') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- Nightly backup at 00:00 UTC.
SELECT cron.schedule('daily-backup-job', '0 0 * * *', $$ SELECT private.run_scheduled_backup('daily'); $$);

-- Weekly backup + email every Thursday at 05:00 UTC (matches the old vercel.json schedule).
SELECT cron.schedule('weekly-backup-job', '0 5 * * 4', $$ SELECT private.run_scheduled_backup('weekly'); $$);
