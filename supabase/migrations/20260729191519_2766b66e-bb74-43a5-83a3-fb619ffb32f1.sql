-- ============ CRM registry ============
CREATE TABLE public.crms (
  key text PRIMARY KEY,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2563eb',
  icon text,
  id_label text NOT NULL DEFAULT 'מספר מערכת',
  record_table text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crms TO authenticated;
GRANT ALL ON public.crms TO service_role;
ALTER TABLE public.crms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crms_select_authenticated" ON public.crms FOR SELECT TO authenticated USING (true);
CREATE POLICY "crms_write_admin" ON public.crms FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER crms_touch BEFORE UPDATE ON public.crms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ per-CRM custom field definitions ============
CREATE TABLE public.crm_field_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_key text NOT NULL REFERENCES public.crms(key) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  show_in_table boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crm_key, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_field_defs TO authenticated;
GRANT ALL ON public.crm_field_defs TO service_role;
ALTER TABLE public.crm_field_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_field_defs_select_authenticated" ON public.crm_field_defs FOR SELECT TO authenticated USING (true);
CREATE POLICY "crm_field_defs_write_admin" ON public.crm_field_defs FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER crm_field_defs_touch BEFORE UPDATE ON public.crm_field_defs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ per-CRM membership ============
CREATE TABLE public.crm_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  crm_key text NOT NULL REFERENCES public.crms(key) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, crm_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_user_roles TO authenticated;
GRANT ALL ON public.crm_user_roles TO service_role;
ALTER TABLE public.crm_user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_user_roles_select_own_or_admin" ON public.crm_user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "crm_user_roles_write_super_admin" ON public.crm_user_roles FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER crm_user_roles_touch BEFORE UPDATE ON public.crm_user_roles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- helper: does a user have at least a given role inside a CRM
CREATE OR REPLACE FUNCTION public.has_crm_access(_user_id uuid, _crm_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(_user_id, 'super_admin'::app_role)
      OR EXISTS (SELECT 1 FROM public.crm_user_roles WHERE user_id = _user_id AND crm_key = _crm_key)
$$;

-- ============ per-CRM settings ============
CREATE TABLE public.crm_settings (
  crm_key text NOT NULL REFERENCES public.crms(key) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (crm_key, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_settings TO authenticated;
GRANT ALL ON public.crm_settings TO service_role;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_settings_select_admin" ON public.crm_settings FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "crm_settings_write_admin" ON public.crm_settings FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));

-- ============ kosher instructions ============
CREATE TABLE public.kosher_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kosher_instructions TO authenticated;
GRANT ALL ON public.kosher_instructions TO service_role;
ALTER TABLE public.kosher_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kosher_select_authenticated" ON public.kosher_instructions FOR SELECT TO authenticated USING (true);
CREATE POLICY "kosher_write_admin" ON public.kosher_instructions FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER kosher_touch BEFORE UPDATE ON public.kosher_instructions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ seed the three CRMs ============
INSERT INTO public.crms (key, name, color, id_label, record_table, sort_order) VALUES
  ('yemot', 'ימות המשיח', '#2563eb', 'מספר מערכת', 'systems', 1),
  ('simahedrin', 'סימהדרין', '#059669', 'מספר מנוי', 'crm_records', 2),
  ('derech', 'דרך בטוחה', '#b45309', 'מספר מכשיר', 'crm_records', 3);

-- ============ backfill membership from global roles ============
INSERT INTO public.crm_user_roles (user_id, crm_key, role)
SELECT ur.user_id, 'yemot', ur.role
FROM public.user_roles ur
WHERE ur.role IN ('admin','agent','viewer','super_admin')
ON CONFLICT (user_id, crm_key) DO NOTHING;

INSERT INTO public.crm_user_roles (user_id, crm_key, role)
SELECT ur.user_id, c.key, 'super_admin'::app_role
FROM public.user_roles ur CROSS JOIN public.crms c
WHERE ur.role = 'super_admin'
ON CONFLICT (user_id, crm_key) DO NOTHING;