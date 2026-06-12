CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO service_role;

ALTER POLICY profiles_delete_admin
ON public.profiles
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY profiles_update_self_or_admin
ON public.profiles
USING ((auth.uid() = id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY status_settings_admin_delete
ON public.status_settings
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY status_settings_admin_insert
ON public.status_settings
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY status_settings_admin_update
ON public.status_settings
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY activity_log_admin_delete
ON public.system_activity_log
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY activity_log_admin_update
ON public.system_activity_log
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY notes_delete_admin_or_author
ON public.system_notes
USING ((auth.uid() = author_id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY notes_update_admin_or_author
ON public.system_notes
USING ((auth.uid() = author_id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY systems_delete_admin
ON public.systems
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY systems_insert_admin
ON public.systems
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY systems_update_admin_or_assigned
ON public.systems
USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR (assigned_agent_id = auth.uid()));

ALTER POLICY roles_admin_write
ON public.user_roles
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY roles_select_self_or_admin
ON public.user_roles
USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM service_role;