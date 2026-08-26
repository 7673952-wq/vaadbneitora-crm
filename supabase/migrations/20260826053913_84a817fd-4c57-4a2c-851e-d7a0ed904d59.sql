-- Single-roundtrip MFA gate used by the server-function middleware.
-- Runs as definer so the browser never needs direct grants on the MFA tables.
CREATE OR REPLACE FUNCTION public.mfa_session_ok(_user_id uuid, _session_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT COALESCE(
      (SELECT us.mfa_enabled FROM public.user_security us WHERE us.user_id = _user_id),
      false
    )
    OR (
      _session_id <> ''
      AND EXISTS (
        SELECT 1 FROM public.mfa_passed_sessions mps
        WHERE mps.user_id = _user_id
          AND mps.session_id = _session_id
          AND mps.expires_at > now()
      )
    );
$$;
REVOKE ALL ON FUNCTION public.mfa_session_ok(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mfa_session_ok(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mfa_session_ok(uuid, text) TO authenticated;