
-- Keep public.has_role (storage policies depend on it) but lock down direct API access
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, authenticated, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_system_transfer() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_system_changes() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_user_role_changes() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.propagate_parent_changes() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inherit_parent_on_insert() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_reminder_handled_on_status_change() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_change_reason(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_change_reason(text) TO authenticated;
