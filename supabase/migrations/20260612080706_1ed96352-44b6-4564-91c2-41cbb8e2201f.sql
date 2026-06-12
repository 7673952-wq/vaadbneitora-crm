REVOKE ALL ON FUNCTION public.log_system_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_system_changes() FROM anon;
REVOKE ALL ON FUNCTION public.log_system_changes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_system_changes() TO service_role;