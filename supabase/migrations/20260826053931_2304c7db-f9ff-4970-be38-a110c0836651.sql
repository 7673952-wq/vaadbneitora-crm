-- Harden mfa_session_ok: a signed-in caller may only probe their own user id,
-- so the function never reveals another user's MFA state.
CREATE OR REPLACE FUNCTION public.mfa_session_ok(_user_id uuid, _session_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid() = _user_id
    AND (
      NOT COALESCE(
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
      )
    );
$$;
REVOKE ALL ON FUNCTION public.mfa_session_ok(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mfa_session_ok(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mfa_session_ok(uuid, text) TO authenticated;