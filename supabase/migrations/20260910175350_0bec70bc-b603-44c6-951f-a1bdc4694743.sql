-- lovable-cron-fallback-reviewed: 1440 runs/day; wake-on-enqueue mention email queue (0 runs when idle) — emails are sent inline on note save, the job is only armed while pending/failed-retry rows exist and is unscheduled as soon as the queue drains.
-- (ג) Durable mentions + email outbox + self-arming queue. Additive only.

CREATE TABLE IF NOT EXISTS public.note_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('system_note', 'crm_record_note')),
  source_note_id uuid NOT NULL,
  mentioned_user_id uuid NOT NULL,
  mentioned_by uuid,
  crm_key text NOT NULL,
  system_id uuid REFERENCES public.systems(id) ON DELETE CASCADE,
  record_id uuid REFERENCES public.crm_records(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_note_id, mentioned_user_id)
);
REVOKE ALL ON public.note_mentions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.note_mentions TO service_role;
ALTER TABLE public.note_mentions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS note_mentions_user_idx ON public.note_mentions (mentioned_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mention_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mention_id uuid NOT NULL UNIQUE REFERENCES public.note_mentions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'skipped_no_email')),
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  claim_at timestamptz,
  last_error text,
  retry_requested_by uuid,
  retry_requested_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.mention_email_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mention_email_deliveries TO service_role;
ALTER TABLE public.mention_email_deliveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS mention_email_deliveries_due_idx
  ON public.mention_email_deliveries (next_retry_at) WHERE status = 'pending';
CREATE TRIGGER mention_email_deliveries_touch BEFORE UPDATE ON public.mention_email_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Active, authorized recipients. Explicit ids are validated one by one so a
-- bad id aborts the whole transaction (note + mentions + queue).
CREATE OR REPLACE FUNCTION private.mention_recipients(
  _crm_key text, _author uuid, _mentioned_user_ids uuid[], _mention_all boolean
) RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _out uuid[] := '{}';
  _all uuid[] := '{}';
  _u uuid;
BEGIN
  FOREACH _u IN ARRAY COALESCE(_mentioned_user_ids, '{}'::uuid[]) LOOP
    IF _u IS NULL OR _u = _author OR _u = ANY (_out) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = _u AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until < now())
    ) THEN
      RAISE EXCEPTION 'המשתמש המתויג אינו פעיל';
    END IF;
    IF NOT public.has_crm_access(_u, _crm_key) THEN
      RAISE EXCEPTION 'למשתמש המתויג אין גישה ל-CRM זה';
    END IF;
    _out := _out || _u;
  END LOOP;

  IF COALESCE(_mention_all, false) THEN
    SELECT COALESCE(array_agg(DISTINCT r0.user_id), '{}'::uuid[]) INTO _all
    FROM public.crm_user_roles r0
    JOIN auth.users u ON u.id = r0.user_id
    WHERE r0.crm_key = _crm_key
      AND (_author IS NULL OR r0.user_id <> _author)
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until < now())
      AND public.has_crm_access(r0.user_id, _crm_key);
    FOREACH _u IN ARRAY _all LOOP
      IF NOT (_u = ANY (_out)) THEN _out := _out || _u; END IF;
    END LOOP;
  END IF;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION private.mention_recipients(text, uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enqueue_mentions(
  _source_type text, _note_id uuid, _crm_key text, _system_id uuid, _record_id uuid,
  _author uuid, _recipients uuid[]
) RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _added uuid[] := '{}';
BEGIN
  WITH ins AS (
    INSERT INTO public.note_mentions (source_type, source_note_id, mentioned_user_id, mentioned_by, crm_key, system_id, record_id)
    SELECT _source_type, _note_id, r, _author, _crm_key, _system_id, _record_id
    FROM unnest(COALESCE(_recipients, '{}'::uuid[])) AS r
    ON CONFLICT (source_type, source_note_id, mentioned_user_id) DO NOTHING
    RETURNING id, mentioned_user_id
  ), q AS (
    INSERT INTO public.mention_email_deliveries (mention_id) SELECT id FROM ins RETURNING mention_id
  )
  SELECT COALESCE(array_agg(mentioned_user_id), '{}'::uuid[]) INTO _added FROM ins;
  RETURN _added;
END $$;
REVOKE ALL ON FUNCTION private.enqueue_mentions(text, uuid, text, uuid, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- Note + mentions + queue rows in ONE transaction. Any failure rolls back all of it.
CREATE OR REPLACE FUNCTION public.add_note_with_mentions(
  _source_type text, _target_id uuid, _crm_key text, _body text,
  _author uuid, _author_name text, _mentioned_user_ids uuid[], _mention_all boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _note_id uuid;
  _recipients uuid[];
  _added uuid[];
  _system_id uuid;
  _record_id uuid;
BEGIN
  IF _source_type NOT IN ('system_note', 'crm_record_note') THEN
    RAISE EXCEPTION 'סוג הערה לא מוכר';
  END IF;
  IF _author IS NULL OR _target_id IS NULL OR btrim(COALESCE(_body, '')) = '' THEN
    RAISE EXCEPTION 'נתוני ההערה חסרים';
  END IF;
  _recipients := private.mention_recipients(_crm_key, _author, _mentioned_user_ids, _mention_all);

  IF _source_type = 'system_note' THEN
    INSERT INTO public.system_notes (system_id, author_id, body)
    VALUES (_target_id, _author, _body) RETURNING id INTO _note_id;
    _system_id := _target_id;
  ELSE
    INSERT INTO public.crm_record_notes (record_id, crm_key, author_id, author_name, body)
    VALUES (_target_id, _crm_key, _author, _author_name, _body) RETURNING id INTO _note_id;
    _record_id := _target_id;
  END IF;

  _added := private.enqueue_mentions(_source_type, _note_id, _crm_key, _system_id, _record_id, _author, _recipients);
  RETURN jsonb_build_object('note_id', _note_id, 'recipients', to_jsonb(_added));
END $$;

CREATE OR REPLACE FUNCTION public.update_note_with_mentions(
  _source_type text, _note_id uuid, _body text,
  _editor uuid, _mentioned_user_ids uuid[], _mention_all boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _crm_key text;
  _system_id uuid;
  _record_id uuid;
  _recipients uuid[];
  _added uuid[];
  _rows bigint := 0;
BEGIN
  IF _source_type = 'system_note' THEN
    UPDATE public.system_notes SET body = _body WHERE id = _note_id RETURNING system_id INTO _system_id;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    _crm_key := 'yemot';
  ELSIF _source_type = 'crm_record_note' THEN
    UPDATE public.crm_record_notes SET body = _body WHERE id = _note_id RETURNING record_id, crm_key INTO _record_id, _crm_key;
    GET DIAGNOSTICS _rows = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'סוג הערה לא מוכר';
  END IF;
  IF _rows = 0 THEN RAISE EXCEPTION 'ההערה לא נמצאה'; END IF;

  _recipients := private.mention_recipients(_crm_key, _editor, _mentioned_user_ids, _mention_all);
  _added := private.enqueue_mentions(_source_type, _note_id, _crm_key, _system_id, _record_id, _editor, _recipients);
  RETURN jsonb_build_object('note_id', _note_id, 'recipients', to_jsonb(_added));
END $$;

-- Atomic claim. A row stuck in 'sending' past the stale window is NOT re-sent:
-- the provider may already have delivered it, so it moves to 'unknown' for review.
CREATE OR REPLACE FUNCTION public.claim_mention_deliveries(_limit integer DEFAULT 20, _stale_seconds integer DEFAULT 600)
RETURNS TABLE(
  delivery_id uuid, mention_id uuid, attempts integer, mentioned_user_id uuid, mentioned_by uuid,
  crm_key text, system_id uuid, record_id uuid, source_type text, source_note_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.mention_email_deliveries d
     SET status = 'unknown',
         last_error = 'השליחה נקטעה באמצע — ייתכן שהמייל כבר נשלח. נדרשת בדיקה ידנית.',
         claim_at = NULL
   WHERE d.status = 'sending'
     AND d.claim_at IS NOT NULL
     AND d.claim_at < now() - make_interval(secs => GREATEST(_stale_seconds, 1));

  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.mention_email_deliveries d
    WHERE d.status = 'pending' AND d.next_retry_at <= now()
    ORDER BY d.next_retry_at
    LIMIT GREATEST(_limit, 1)
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.mention_email_deliveries d
       SET status = 'sending', claim_at = now(), attempts = d.attempts + 1
      FROM due WHERE d.id = due.id
    RETURNING d.id, d.mention_id, d.attempts
  )
  SELECT upd.id, upd.mention_id, upd.attempts, m.mentioned_user_id, m.mentioned_by,
         m.crm_key, m.system_id, m.record_id, m.source_type, m.source_note_id
  FROM upd JOIN public.note_mentions m ON m.id = upd.mention_id;
END $$;

-- Compare-and-set finish: only a row still 'sending' can be finalized.
CREATE OR REPLACE FUNCTION public.finish_mention_delivery(
  _delivery_id uuid, _status text, _error text DEFAULT NULL, _retry_in_seconds integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _rows bigint := 0;
BEGIN
  IF _status NOT IN ('pending', 'sent', 'failed', 'unknown', 'skipped_no_email') THEN
    RAISE EXCEPTION 'סטטוס משלוח לא חוקי';
  END IF;
  UPDATE public.mention_email_deliveries
     SET status = _status,
         last_error = _error,
         claim_at = NULL,
         sent_at = CASE WHEN _status = 'sent' THEN now() ELSE sent_at END,
         next_retry_at = CASE WHEN _status = 'pending' THEN now() + make_interval(secs => GREATEST(COALESCE(_retry_in_seconds, 60), 1)) ELSE next_retry_at END
   WHERE id = _delivery_id AND status = 'sending';
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $$;

-- Explicit, audited retry of a failed/unknown delivery (server checks permission + rate limit).
CREATE OR REPLACE FUNCTION public.requeue_mention_delivery(_delivery_id uuid, _actor uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _rows bigint := 0;
BEGIN
  UPDATE public.mention_email_deliveries
     SET status = 'pending', next_retry_at = now(), claim_at = NULL,
         retry_requested_by = _actor, retry_requested_at = now()
   WHERE id = _delivery_id AND status IN ('failed', 'unknown', 'skipped_no_email');
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $$;

-- Queue endpoints: explicit per-environment configuration (no secret here).
INSERT INTO private.cron_tokens (name, token)
VALUES ('mention_queue', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cron_token_valid(_name text, _token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.cron_tokens
    WHERE name = _name AND token = _token AND length(_token) >= 32
  );
$$;

CREATE OR REPLACE FUNCTION public.set_queue_endpoint(_name text, _url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  IF _name NOT IN ('voice_queue', 'mention_queue') THEN
    RAISE EXCEPTION 'תור לא מוכר';
  END IF;
  IF _url IS NULL OR _url !~ '^https://' THEN
    RAISE EXCEPTION 'כתובת היעד חייבת להתחיל ב-https';
  END IF;
  INSERT INTO private.cron_config (key, value, updated_at)
  VALUES (_name || '_url', _url, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.get_queue_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT jsonb_build_object(
    'voice', jsonb_build_object(
      'url', (SELECT value FROM private.cron_config WHERE key = 'voice_queue_url'),
      'updated_at', (SELECT updated_at FROM private.cron_config WHERE key = 'voice_queue_url'),
      'armed', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voice-queue'),
      'pending', (SELECT count(*) FROM public.systems WHERE pending_voice_send_at IS NOT NULL),
      'token_configured', EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = 'voice_queue')
    ),
    'mention', jsonb_build_object(
      'url', (SELECT value FROM private.cron_config WHERE key = 'mention_queue_url'),
      'updated_at', (SELECT updated_at FROM private.cron_config WHERE key = 'mention_queue_url'),
      'armed', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mention-queue'),
      'pending', (SELECT count(*) FROM public.mention_email_deliveries WHERE status IN ('pending', 'sending')),
      'token_configured', EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = 'mention_queue')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_mention_queue_job()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
DECLARE
  _token text;
  _url text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mention_queue_job'));
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mention-queue') THEN
    RETURN false;
  END IF;
  SELECT value INTO _url FROM private.cron_config WHERE key = 'mention_queue_url';
  IF _url IS NULL THEN
    RAISE EXCEPTION 'כתובת היעד של תור התיוגים אינה מוגדרת (ניהול → התראות → תורי רקע)';
  END IF;
  SELECT token INTO _token FROM private.cron_tokens WHERE name = 'mention_queue';
  IF _token IS NULL THEN
    RAISE EXCEPTION 'אסימון תור התיוגים אינו מוגדר';
  END IF;
  PERFORM cron.schedule(
    'mention-queue',
    '* * * * *',
    format(
      'SELECT net.http_post(url := %L, headers := %L::jsonb, body := ''{}''::jsonb);',
      _url,
      json_build_object('Content-Type', 'application/json', 'x-cron-token', _token)::text
    )
  );
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.drain_mention_queue_job()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mention_queue_job'));
  IF EXISTS (SELECT 1 FROM public.mention_email_deliveries WHERE status IN ('pending', 'sending')) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mention-queue') THEN
    PERFORM cron.unschedule('mention-queue');
    RETURN true;
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.add_note_with_mentions(text, uuid, text, text, uuid, text, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_note_with_mentions(text, uuid, text, uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_mention_deliveries(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_mention_delivery(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_mention_delivery(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_token_valid(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_queue_endpoint(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_queue_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_mention_queue_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drain_mention_queue_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_note_with_mentions(text, uuid, text, text, uuid, text, uuid[], boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_note_with_mentions(text, uuid, text, uuid, uuid[], boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_mention_deliveries(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_mention_delivery(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_mention_delivery(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_token_valid(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_queue_endpoint(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_queue_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_mention_queue_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.drain_mention_queue_job() TO service_role;