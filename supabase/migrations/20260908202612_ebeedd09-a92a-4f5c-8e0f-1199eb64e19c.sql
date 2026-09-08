-- 1) MFA session check: server-side only.
CREATE OR REPLACE FUNCTION public.mfa_session_ok(_user_id uuid, _session_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
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
$function$;

REVOKE ALL ON FUNCTION public.mfa_session_ok(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_session_ok(uuid, text) TO service_role;

-- 2) profiles: restrict who can read, and which columns.
CREATE OR REPLACE FUNCTION private.is_app_member(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles cur WHERE cur.user_id = _user_id)
  );
$function$;

REVOKE ALL ON FUNCTION private.is_app_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_app_member(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
CREATE POLICY profiles_select_self_or_member ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR private.is_app_member(auth.uid()));

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, display_name, created_at, email_display_name) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;