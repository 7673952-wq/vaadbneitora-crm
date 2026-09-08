-- lovable-cron-fallback-reviewed: 288 runs/day; wake-on-enqueue and unschedule-after-drain, so it only exists while a voice message is waiting; a 90s user-configured debounce rules out hourly polling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS voice_pending_reason text,
  ADD COLUMN IF NOT EXISTS voice_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_last_error text,
  ADD COLUMN IF NOT EXISTS voice_claim_at timestamptz;

ALTER TABLE public.systems
  DROP CONSTRAINT IF EXISTS systems_voice_pending_reason_chk;
ALTER TABLE public.systems
  ADD CONSTRAINT systems_voice_pending_reason_chk
  CHECK (voice_pending_reason IS NULL OR voice_pending_reason IN ('debounce','window','retry'));

CREATE INDEX IF NOT EXISTS systems_voice_pending_idx
  ON public.systems (pending_voice_send_at)
  WHERE pending_voice_send_at IS NOT NULL;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.cron_tokens (
  name text PRIMARY KEY,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.cron_tokens (name, token)
VALUES ('voice_queue', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.voice_cron_token_valid(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.cron_tokens
    WHERE name = 'voice_queue' AND token = _token AND length(_token) >= 32
  );
$$;
REVOKE ALL ON FUNCTION public.voice_cron_token_valid(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_cron_token_valid(text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_voice_queue_job()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  _token text;
  _url text := 'https://project--bee711c7-69fe-4131-9859-c15e001815c1.lovable.app/api/public/hooks/process-voice-queue';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voice-queue') THEN
    RETURN false;
  END IF;
  SELECT token INTO _token FROM private.cron_tokens WHERE name = 'voice_queue';
  IF _token IS NULL THEN RETURN false; END IF;
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
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_voice_queue_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_voice_queue_job() TO service_role;

CREATE OR REPLACE FUNCTION public.drain_voice_queue_job()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.systems WHERE pending_voice_send_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voice-queue') THEN
    PERFORM cron.unschedule('voice-queue');
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.drain_voice_queue_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_voice_queue_job() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_voice_queue(_limit integer DEFAULT 50, _stale_seconds integer DEFAULT 600)
RETURNS TABLE(id uuid, status text, voice_pending_reason text, voice_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id
    FROM public.systems s
    WHERE s.pending_voice_send_at IS NOT NULL
      AND s.pending_voice_send_at <= now()
      AND (s.voice_claim_at IS NULL OR s.voice_claim_at < now() - make_interval(secs => _stale_seconds))
    ORDER BY s.pending_voice_send_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.systems s
     SET voice_claim_at = now()
    FROM due
   WHERE s.id = due.id
  RETURNING s.id, s.status::text, s.voice_pending_reason, s.voice_attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_voice_queue(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_voice_queue(integer, integer) TO service_role;