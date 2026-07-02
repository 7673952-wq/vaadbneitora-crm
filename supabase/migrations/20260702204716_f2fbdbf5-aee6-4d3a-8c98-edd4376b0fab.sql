ALTER TABLE public.status_settings
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role public.app_role NOT NULL,
  permission text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (role, permission),
  CONSTRAINT role_permissions_permission_check CHECK (permission ~ '^[a-z0-9_]+$')
);

GRANT SELECT ON public.role_permissions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_read_authenticated" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions_super_admin_write" ON public.role_permissions;

CREATE POLICY "role_permissions_read_authenticated"
  ON public.role_permissions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "role_permissions_super_admin_write"
  ON public.role_permissions
  FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id uuid NOT NULL,
  permission text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (user_id, permission),
  CONSTRAINT user_permissions_permission_check CHECK (permission ~ '^[a-z0-9_]+$')
);

GRANT SELECT ON public.user_permissions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_permissions_read_self_or_super_admin" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_super_admin_write" ON public.user_permissions;

CREATE POLICY "user_permissions_read_self_or_super_admin"
  ON public.user_permissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "user_permissions_super_admin_write"
  ON public.user_permissions
  FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'super_admin'::public.app_role));

DROP TRIGGER IF EXISTS touch_role_permissions_updated_at ON public.role_permissions;
CREATE TRIGGER touch_role_permissions_updated_at
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_user_permissions_updated_at ON public.user_permissions;
CREATE TRIGGER touch_user_permissions_updated_at
  BEFORE UPDATE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.role_permissions (role, permission, allowed)
VALUES
  ('viewer', 'systems_read', true),
  ('viewer', 'systems_write', false),
  ('viewer', 'systems_delete', false),
  ('viewer', 'status_change', false),
  ('viewer', 'agent_transfer', false),
  ('viewer', 'notes_write', false),
  ('viewer', 'files_manage', false),
  ('viewer', 'import_export', false),
  ('viewer', 'series_manage', false),
  ('viewer', 'backup_manage', false),
  ('viewer', 'audit_view', false),
  ('viewer', 'settings_manage', false),
  ('viewer', 'users_manage', false),
  ('viewer', 'permissions_manage', false),
  ('agent', 'systems_read', true),
  ('agent', 'systems_write', true),
  ('agent', 'systems_delete', false),
  ('agent', 'status_change', true),
  ('agent', 'agent_transfer', true),
  ('agent', 'notes_write', true),
  ('agent', 'files_manage', true),
  ('agent', 'import_export', false),
  ('agent', 'series_manage', false),
  ('agent', 'backup_manage', false),
  ('agent', 'audit_view', false),
  ('agent', 'settings_manage', false),
  ('agent', 'users_manage', false),
  ('agent', 'permissions_manage', false),
  ('admin', 'systems_read', true),
  ('admin', 'systems_write', true),
  ('admin', 'systems_delete', false),
  ('admin', 'status_change', true),
  ('admin', 'agent_transfer', true),
  ('admin', 'notes_write', true),
  ('admin', 'files_manage', true),
  ('admin', 'import_export', true),
  ('admin', 'series_manage', true),
  ('admin', 'backup_manage', true),
  ('admin', 'audit_view', false),
  ('admin', 'settings_manage', true),
  ('admin', 'users_manage', false),
  ('admin', 'permissions_manage', false),
  ('super_admin', 'systems_read', true),
  ('super_admin', 'systems_write', true),
  ('super_admin', 'systems_delete', true),
  ('super_admin', 'status_change', true),
  ('super_admin', 'agent_transfer', true),
  ('super_admin', 'notes_write', true),
  ('super_admin', 'files_manage', true),
  ('super_admin', 'import_export', true),
  ('super_admin', 'series_manage', true),
  ('super_admin', 'backup_manage', true),
  ('super_admin', 'audit_view', true),
  ('super_admin', 'settings_manage', true),
  ('super_admin', 'users_manage', true),
  ('super_admin', 'permissions_manage', true)
ON CONFLICT (role, permission) DO NOTHING;