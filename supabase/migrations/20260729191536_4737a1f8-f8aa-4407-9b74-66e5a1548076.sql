REVOKE ALL ON FUNCTION public.has_crm_access(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_crm_access(uuid, text) TO service_role;