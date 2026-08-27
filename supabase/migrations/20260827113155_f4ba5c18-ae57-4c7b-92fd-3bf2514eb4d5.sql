-- Atomic OTP consume + grant issue
CREATE OR REPLACE FUNCTION public.otp_consume_and_grant(
  _challenge_id uuid,
  _code_hash text,
  _grant_hash text,
  _grant_expires timestamptz,
  _max_attempts integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ch public.login_otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO ch FROM public.login_otp_challenges
    WHERE id = _challenge_id FOR UPDATE;
  IF NOT FOUND
     OR ch.consumed_at IS NOT NULL
     OR ch.state <> 'active'
     OR ch.attempts >= _max_attempts
     OR ch.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  IF ch.code_hash IS DISTINCT FROM _code_hash THEN
    UPDATE public.login_otp_challenges SET attempts = ch.attempts + 1 WHERE id = ch.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_code');
  END IF;

  UPDATE public.login_otp_challenges
    SET consumed_at = now(), attempts = ch.attempts + 1
    WHERE id = ch.id;

  INSERT INTO public.mfa_grants (user_id, grant_hash, expires_at)
    VALUES (ch.user_id, _grant_hash, _grant_expires);

  RETURN jsonb_build_object('ok', true, 'user_id', ch.user_id);
END $$;

-- Atomic grant exchange -> session proof
CREATE OR REPLACE FUNCTION public.mfa_consume_grant(
  _grant_hash text,
  _user_id uuid,
  _session_id text,
  _expires timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g public.mfa_grants%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.mfa_grants
    WHERE grant_hash = _grant_hash FOR UPDATE;
  IF NOT FOUND
     OR g.user_id <> _user_id
     OR g.consumed_at IS NOT NULL
     OR g.expires_at < now() THEN
    RETURN false;
  END IF;

  UPDATE public.mfa_grants SET consumed_at = now() WHERE id = g.id;

  INSERT INTO public.mfa_passed_sessions (session_id, user_id, expires_at)
    VALUES (_session_id, _user_id, _expires)
    ON CONFLICT (session_id) DO UPDATE
      SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at;

  RETURN true;
END $$;

-- Atomic activation of a freshly sent code + revocation of older ones
CREATE OR REPLACE FUNCTION public.otp_activate_resend(
  _new_id uuid,
  _code_hash text,
  _user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.login_otp_challenges
    SET code_hash = _code_hash, state = 'active'
    WHERE id = _new_id AND user_id = _user_id AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.login_otp_challenges
    SET state = 'revoked'
    WHERE user_id = _user_id
      AND id <> _new_id
      AND consumed_at IS NULL
      AND state IN ('pending', 'active');

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.otp_consume_and_grant(uuid, text, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mfa_consume_grant(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.otp_activate_resend(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_consume_and_grant(uuid, text, text, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_consume_grant(text, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.otp_activate_resend(uuid, text, uuid) TO service_role;