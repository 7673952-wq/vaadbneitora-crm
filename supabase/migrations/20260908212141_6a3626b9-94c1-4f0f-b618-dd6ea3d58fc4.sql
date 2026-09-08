-- Policies call private.has_role()/private.is_app_member(); without USAGE on the
-- schema every read fails with "permission denied for schema private".
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM authenticated, anon;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_app_member(uuid) TO authenticated;