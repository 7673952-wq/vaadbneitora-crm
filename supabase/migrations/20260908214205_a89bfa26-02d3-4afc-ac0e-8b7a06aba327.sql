-- lovable-cron-fallback-reviewed: 288 runs/day; wake-on-enqueue queue job, unscheduled as soon as the queue drains, so it never polls when idle.
-- 1. Atomic claim for manual request decisions ------------------------------
ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS decision_claim_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_claim_by uuid;

CREATE OR REPLACE FUNCTION public.claim_system_request(_id uuid, _actor uuid, _stale_seconds integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.system_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.system_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.decision_status IS NOT NULL
     AND r.decision_status NOT IN ('needs_decision', 'simulated') THEN
    RETURN NULL;
  END IF;
  IF r.decision_claim_at IS NOT NULL
     AND r.decision_claim_at > now() - make_interval(secs => GREATEST(_stale_seconds, 1)) THEN
    RETURN NULL;
  END IF;
  UPDATE public.system_requests
     SET decision_claim_at = now(), decision_claim_by = _actor
   WHERE id = _id;
  r.decision_claim_at := now();
  r.decision_claim_by := _actor;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.release_system_request_claim(_id uuid, _actor uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH upd AS (
    UPDATE public.system_requests
       SET decision_claim_at = NULL, decision_claim_by = NULL
     WHERE id = _id AND decision_claim_by = _actor
     RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM upd);
$$;

REVOKE ALL ON FUNCTION public.claim_system_request(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_system_request_claim(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_system_request(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_system_request_claim(uuid, uuid) TO service_role;

-- 2. Voice queue cron: configurable target URL + race-free arm/disarm --------
CREATE TABLE IF NOT EXISTS private.cron_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.cron_config FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_voice_queue_endpoint(_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  IF _url IS NULL OR _url !~ '^https://' THEN
    RAISE EXCEPTION 'כתובת היעד חייבת להתחיל ב-https';
  END IF;
  INSERT INTO private.cron_config (key, value, updated_at)
  VALUES ('voice_queue_url', _url, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.get_voice_queue_endpoint()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$ SELECT value FROM private.cron_config WHERE key = 'voice_queue_url' $$;

REVOKE ALL ON FUNCTION public.set_voice_queue_endpoint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_voice_queue_endpoint() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_voice_queue_endpoint(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_voice_queue_endpoint() TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_voice_queue_job()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
DECLARE
  _token text;
  _url text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('voice_queue_job'));
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voice-queue') THEN
    RETURN false;
  END IF;
  SELECT value INTO _url FROM private.cron_config WHERE key = 'voice_queue_url';
  IF _url IS NULL THEN
    RAISE EXCEPTION 'כתובת היעד של תור ההודעות הקוליות אינה מוגדרת';
  END IF;
  SELECT token INTO _token FROM private.cron_tokens WHERE name = 'voice_queue';
  IF _token IS NULL THEN
    RAISE EXCEPTION 'אסימון תור ההודעות הקוליות אינו מוגדר';
  END IF;
  PERFORM cron.schedule(
    'voice-queue',
    '*/5 * * * *',
    format(
      'SELECT net.http_post(url := %L, headers := %L::jsonb, body := ''{}''::jsonb);',
      _url,
      json_build_object('Content-Type', 'application/json', 'x-cron-token', _token)::text
    )
  );
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.drain_voice_queue_job()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('voice_queue_job'));
  IF EXISTS (SELECT 1 FROM public.systems WHERE pending_voice_send_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voice-queue') THEN
    PERFORM cron.unschedule('voice-queue');
    RETURN true;
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.ensure_voice_queue_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drain_voice_queue_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_voice_queue_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.drain_voice_queue_job() TO service_role;

-- 3. Internal permission tables: server-only ---------------------------------
REVOKE ALL ON public.role_permissions FROM anon, authenticated;
REVOKE ALL ON public.user_permissions FROM anon, authenticated;
REVOKE ALL ON public.notification_role_defaults FROM anon, authenticated;
GRANT ALL ON public.role_permissions TO service_role;
GRANT ALL ON public.user_permissions TO service_role;
GRANT ALL ON public.notification_role_defaults TO service_role;