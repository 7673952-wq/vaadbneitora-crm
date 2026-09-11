CREATE OR REPLACE FUNCTION public.set_user_role_atomic(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL OR _role IS NULL THEN RAISE EXCEPTION 'נתוני תפקיד חסרים'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  IF _role = 'super_admin' THEN
    -- Preserve the app's convention: a super admin also carries the admin row.
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'admin'), (_user_id, 'super_admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  END IF;
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.set_user_role_atomic(uuid, app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role_atomic(uuid, app_role) TO service_role;