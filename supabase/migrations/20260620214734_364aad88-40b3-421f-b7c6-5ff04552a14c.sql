-- Ensure schemas exist
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- 1. Move SECURITY DEFINER trigger/auth functions out of public into private
ALTER FUNCTION public.handle_new_user() SET SCHEMA private;
ALTER FUNCTION public.log_system_transfer() SET SCHEMA private;
ALTER FUNCTION public.log_system_changes() SET SCHEMA private;
ALTER FUNCTION public.log_user_role_changes() SET SCHEMA private;
ALTER FUNCTION public.propagate_parent_changes() SET SCHEMA private;
ALTER FUNCTION public.inherit_parent_on_insert() SET SCHEMA private;
ALTER FUNCTION public.reset_reminder_handled_on_status_change() SET SCHEMA private;

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.log_system_transfer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.log_system_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.log_user_role_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.propagate_parent_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.inherit_parent_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reset_reminder_handled_on_status_change() FROM PUBLIC, anon, authenticated;

-- 2. Recreate backups storage policies to use private.has_role
DROP POLICY IF EXISTS "Admins can read backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete backups" ON storage.objects;

CREATE POLICY "Admins can read backups" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'backups' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can upload backups" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'backups' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete backups" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'backups' AND private.has_role(auth.uid(), 'admin'::app_role));

-- 3. Drop the public.has_role shim
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role);

-- 4. Reinstall pg_net in the extensions schema (it doesn't support SET SCHEMA)
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;