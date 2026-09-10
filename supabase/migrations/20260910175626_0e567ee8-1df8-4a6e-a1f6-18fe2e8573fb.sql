-- (ד) Atomic role replacement --------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_role_atomic(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _user_id IS NULL OR _role IS NULL THEN RAISE EXCEPTION 'נתוני תפקיד חסרים'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_user_role_atomic(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role_atomic(uuid, public.app_role) TO service_role;

-- (ה) Voice deliveries: durable intent BEFORE the provider call ------------------
CREATE TABLE IF NOT EXISTS public.voice_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id uuid NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  phone_index integer NOT NULL,
  phone text,
  status_key text,
  send_mode text NOT NULL DEFAULT 'manual',
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown', 'acknowledged')),
  started_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  claim_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  campaign_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (system_id, phone_index)
);
REVOKE ALL ON public.voice_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.voice_deliveries TO service_role;
ALTER TABLE public.voice_deliveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS voice_deliveries_status_idx ON public.voice_deliveries (status) WHERE status IN ('sending', 'unknown');
CREATE TRIGGER voice_deliveries_touch BEFORE UPDATE ON public.voice_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 'proceed' | 'busy' | 'unknown'. A stale 'sending' row is flipped to 'unknown'
-- and the provider is NOT called again until someone acknowledges it.
CREATE OR REPLACE FUNCTION public.begin_voice_delivery(
  _system_id uuid, _phone_index integer, _phone text, _status_key text, _send_mode text,
  _actor uuid, _stale_seconds integer DEFAULT 600
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.voice_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.voice_deliveries
   WHERE system_id = _system_id AND phone_index = _phone_index FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.voice_deliveries (system_id, phone_index, phone, status_key, send_mode, status, started_by, started_at, claim_at)
    VALUES (_system_id, _phone_index, _phone, _status_key, COALESCE(_send_mode, 'manual'), 'sending', _actor, now(), now());
    RETURN 'proceed';
  END IF;
  IF r.status = 'sending' THEN
    IF r.claim_at > now() - make_interval(secs => GREATEST(_stale_seconds, 1)) THEN
      RETURN 'busy';
    END IF;
    UPDATE public.voice_deliveries
       SET status = 'unknown',
           error = 'השליחה נקטעה באמצע — ייתכן שהשיחה כבר בוצעה. נדרש אישור ידני לפני שליחה חוזרת.',
           finished_at = now()
     WHERE id = r.id;
    RETURN 'unknown';
  END IF;
  IF r.status = 'unknown' THEN
    RETURN 'unknown';
  END IF;
  UPDATE public.voice_deliveries
     SET status = 'sending', phone = _phone, status_key = _status_key, send_mode = COALESCE(_send_mode, 'manual'),
         started_by = _actor, started_at = now(), claim_at = now(), finished_at = NULL,
         error = NULL, campaign_id = NULL
   WHERE id = r.id;
  RETURN 'proceed';
END $$;

-- One transaction: delivery outcome + system "sent" marker + audit log row.
CREATE OR REPLACE FUNCTION public.finish_voice_delivery(
  _system_id uuid, _phone_index integer, _status text, _error text DEFAULT NULL,
  _campaign_id text DEFAULT NULL, _actor uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.voice_deliveries%ROWTYPE;
  _code text;
  _now timestamptz := now();
  _arr jsonb;
BEGIN
  IF _status NOT IN ('sent', 'failed') THEN RAISE EXCEPTION 'תוצאת משלוח לא חוקית'; END IF;
  UPDATE public.voice_deliveries
     SET status = _status, error = _error, campaign_id = _campaign_id, finished_at = _now
   WHERE system_id = _system_id AND phone_index = _phone_index AND status = 'sending'
  RETURNING * INTO r;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT system_code INTO _code FROM public.systems WHERE id = _system_id;

  IF _status = 'sent' THEN
    IF _phone_index < 0 THEN
      UPDATE public.systems SET voice_message_sent_at = _now WHERE id = _system_id;
    ELSE
      SELECT additional_caller_phones INTO _arr FROM public.systems WHERE id = _system_id FOR UPDATE;
      IF _arr IS NOT NULL AND jsonb_typeof(_arr) = 'array' AND jsonb_array_length(_arr) > _phone_index THEN
        _arr := jsonb_set(_arr, ARRAY[_phone_index::text, 'sent_at'], to_jsonb(_now::text), true);
        UPDATE public.systems SET additional_caller_phones = _arr WHERE id = _system_id;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.voice_message_log (system_id, system_code, phone, phone_index, status_key, send_mode, success, error_message, created_by)
  VALUES (_system_id, _code, r.phone, _phone_index, r.status_key, r.send_mode, _status = 'sent', left(_error, 500), COALESCE(_actor, r.started_by));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.acknowledge_voice_delivery(_system_id uuid, _phone_index integer, _actor uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _rows bigint := 0;
BEGIN
  UPDATE public.voice_deliveries
     SET status = 'acknowledged', acknowledged_by = _actor, acknowledged_at = now()
   WHERE system_id = _system_id AND phone_index = _phone_index AND status = 'unknown';
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $$;

REVOKE ALL ON FUNCTION public.begin_voice_delivery(uuid, integer, text, text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_voice_delivery(uuid, integer, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_voice_delivery(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_voice_delivery(uuid, integer, text, text, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_voice_delivery(uuid, integer, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_voice_delivery(uuid, integer, uuid) TO service_role;

-- (ו) Email deliveries: operation record with an idempotency key ---------------
CREATE TABLE IF NOT EXISTS public.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  created_by uuid,
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
  attempts integer NOT NULL DEFAULT 0,
  claim_at timestamptz,
  relay_message_id text,
  relay_thread_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.email_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_deliveries TO service_role;
ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER email_deliveries_touch BEFORE UPDATE ON public.email_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Returns jsonb {action: proceed|duplicate|busy|unknown, status, message_id}
CREATE OR REPLACE FUNCTION public.begin_email_delivery(
  _key text, _kind text, _actor uuid, _target jsonb, _stale_seconds integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.email_deliveries%ROWTYPE;
BEGIN
  IF _key IS NULL OR length(_key) < 16 OR length(_key) > 200 THEN
    RAISE EXCEPTION 'מפתח פעולה לא חוקי';
  END IF;
  SELECT * INTO r FROM public.email_deliveries WHERE idempotency_key = _key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.email_deliveries (idempotency_key, kind, created_by, target, status, attempts, claim_at)
    VALUES (_key, _kind, _actor, COALESCE(_target, '{}'::jsonb), 'sending', 1, now());
    RETURN jsonb_build_object('action', 'proceed', 'status', 'sending');
  END IF;
  IF r.created_by IS DISTINCT FROM _actor THEN
    RAISE EXCEPTION 'מפתח הפעולה שייך למשתמש אחר';
  END IF;
  IF r.status = 'sent' THEN
    RETURN jsonb_build_object('action', 'duplicate', 'status', 'sent', 'message_id', r.relay_message_id);
  END IF;
  IF r.status = 'unknown' THEN
    RETURN jsonb_build_object('action', 'unknown', 'status', 'unknown');
  END IF;
  IF r.status = 'sending' THEN
    IF r.claim_at IS NOT NULL AND r.claim_at > now() - make_interval(secs => GREATEST(_stale_seconds, 1)) THEN
      RETURN jsonb_build_object('action', 'busy', 'status', 'sending');
    END IF;
    UPDATE public.email_deliveries
       SET status = 'unknown', claim_at = NULL,
           last_error = 'השליחה נקטעה באמצע — ייתכן שהמייל כבר נשלח. לא בוצעה שליחה חוזרת אוטומטית.'
     WHERE id = r.id;
    RETURN jsonb_build_object('action', 'unknown', 'status', 'unknown');
  END IF;
  -- failed → explicit retry of the same operation
  UPDATE public.email_deliveries
     SET status = 'sending', attempts = r.attempts + 1, claim_at = now(), last_error = NULL
   WHERE id = r.id;
  RETURN jsonb_build_object('action', 'proceed', 'status', 'sending', 'attempt', r.attempts + 1);
END $$;

CREATE OR REPLACE FUNCTION public.finish_email_delivery(
  _key text, _status text, _error text DEFAULT NULL, _relay_message_id text DEFAULT NULL, _relay_thread_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _rows bigint := 0;
BEGIN
  IF _status NOT IN ('sent', 'failed', 'unknown') THEN RAISE EXCEPTION 'סטטוס משלוח לא חוקי'; END IF;
  UPDATE public.email_deliveries
     SET status = _status, last_error = _error, claim_at = NULL,
         relay_message_id = COALESCE(_relay_message_id, relay_message_id),
         relay_thread_id = COALESCE(_relay_thread_id, relay_thread_id),
         sent_at = CASE WHEN _status = 'sent' THEN now() ELSE sent_at END
   WHERE idempotency_key = _key AND status = 'sending';
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $$;

REVOKE ALL ON FUNCTION public.begin_email_delivery(text, text, uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_email_delivery(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_email_delivery(text, text, uuid, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_email_delivery(text, text, text, text, text) TO service_role;