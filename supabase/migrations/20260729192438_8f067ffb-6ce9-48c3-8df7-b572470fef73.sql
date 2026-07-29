CREATE TABLE public.crm_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_key text NOT NULL REFERENCES public.crms(key) ON DELETE CASCADE,
  record_code text NOT NULL,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  assigned_agent_id uuid,
  phone text,
  caller_phone text,
  email text,
  source text,
  notes text,
  reminder_at timestamptz,
  parent_record_id uuid REFERENCES public.crm_records(id) ON DELETE SET NULL,
  custom jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_records_crm_key_idx ON public.crm_records (crm_key, created_at DESC);
CREATE INDEX crm_records_code_idx ON public.crm_records (crm_key, record_code);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_records TO authenticated;
GRANT ALL ON public.crm_records TO service_role;
ALTER TABLE public.crm_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_records_select_member" ON public.crm_records FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_records.crm_key));
CREATE POLICY "crm_records_insert_member" ON public.crm_records FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_records.crm_key AND r.role <> 'viewer'));
CREATE POLICY "crm_records_update_member" ON public.crm_records FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_records.crm_key AND r.role <> 'viewer'))
  WITH CHECK (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_records.crm_key AND r.role <> 'viewer'));
CREATE POLICY "crm_records_delete_admin" ON public.crm_records FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_records.crm_key AND r.role = 'admin'));
CREATE TRIGGER crm_records_touch BEFORE UPDATE ON public.crm_records FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.crm_record_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  crm_key text NOT NULL REFERENCES public.crms(key) ON DELETE CASCADE,
  author_id uuid,
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_record_notes_record_idx ON public.crm_record_notes (record_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_record_notes TO authenticated;
GRANT ALL ON public.crm_record_notes TO service_role;
ALTER TABLE public.crm_record_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_record_notes_select_member" ON public.crm_record_notes FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_record_notes.crm_key));
CREATE POLICY "crm_record_notes_write_member" ON public.crm_record_notes FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_record_notes.crm_key AND r.role <> 'viewer'))
  WITH CHECK (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_record_notes.crm_key AND r.role <> 'viewer'));
CREATE TRIGGER crm_record_notes_touch BEFORE UPDATE ON public.crm_record_notes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.crm_record_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid REFERENCES public.crm_records(id) ON DELETE CASCADE,
  crm_key text NOT NULL REFERENCES public.crms(key) ON DELETE CASCADE,
  actor_id uuid,
  actor_display_name text,
  action text NOT NULL,
  field text,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_record_activity_record_idx ON public.crm_record_activity (record_id, created_at DESC);
GRANT SELECT ON public.crm_record_activity TO authenticated;
GRANT ALL ON public.crm_record_activity TO service_role;
ALTER TABLE public.crm_record_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_record_activity_select_member" ON public.crm_record_activity FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = crm_record_activity.crm_key));