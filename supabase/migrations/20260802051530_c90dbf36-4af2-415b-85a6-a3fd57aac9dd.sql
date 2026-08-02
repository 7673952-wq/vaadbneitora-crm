CREATE OR REPLACE FUNCTION public.has_crm_access(_user_id uuid, _crm_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.has_role(_user_id, 'super_admin'::app_role)
      OR EXISTS (
        SELECT 1
        FROM public.crm_user_roles
        WHERE user_id = _user_id
          AND crm_key = _crm_key
      )
$$;
GRANT EXECUTE ON FUNCTION public.has_crm_access(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_crm_access(uuid, text) FROM PUBLIC, anon;