ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS crm_key text NOT NULL DEFAULT 'yemot';
ALTER TABLE public.user_permissions
  ADD COLUMN IF NOT EXISTS crm_key text NOT NULL DEFAULT 'yemot';

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype IN ('p','u')
      AND conrelid IN ('public.role_permissions'::regclass, 'public.user_permissions'::regclass)
      AND pg_get_constraintdef(oid) NOT ILIKE '%crm_key%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (crm_key, role, permission);
ALTER TABLE public.user_permissions
  ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (crm_key, user_id, permission);

CREATE INDEX IF NOT EXISTS role_permissions_crm_key_idx ON public.role_permissions (crm_key);
CREATE INDEX IF NOT EXISTS user_permissions_crm_key_idx ON public.user_permissions (crm_key);

ALTER TABLE public.email_messages
  ALTER COLUMN system_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS crm_record_id uuid REFERENCES public.crm_records(id) ON DELETE CASCADE;
ALTER TABLE public.email_threads
  ALTER COLUMN system_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS crm_record_id uuid REFERENCES public.crm_records(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS email_messages_crm_record_id_idx ON public.email_messages (crm_record_id, created_at);
CREATE INDEX IF NOT EXISTS email_threads_crm_record_id_idx ON public.email_threads (crm_record_id);

ALTER TABLE public.email_messages DROP CONSTRAINT IF EXISTS email_messages_owner_check;
ALTER TABLE public.email_messages ADD CONSTRAINT email_messages_owner_check
  CHECK ((system_id IS NOT NULL)::integer + (crm_record_id IS NOT NULL)::integer = 1);
ALTER TABLE public.email_threads DROP CONSTRAINT IF EXISTS email_threads_owner_check;
ALTER TABLE public.email_threads ADD CONSTRAINT email_threads_owner_check
  CHECK ((system_id IS NOT NULL)::integer + (crm_record_id IS NOT NULL)::integer = 1);

DROP POLICY IF EXISTS systems_select_all ON public.systems;
DROP POLICY IF EXISTS systems_insert_admin ON public.systems;
DROP POLICY IF EXISTS systems_update_admin_or_assigned ON public.systems;
DROP POLICY IF EXISTS systems_delete_admin ON public.systems;
CREATE POLICY systems_select_yemot_member ON public.systems FOR SELECT TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot'));
CREATE POLICY systems_insert_yemot_writer ON public.systems FOR INSERT TO authenticated
  WITH CHECK (public.has_crm_access(auth.uid(), 'yemot') AND (private.has_role(auth.uid(), 'super_admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role <> 'viewer'::app_role
  )));
CREATE POLICY systems_update_yemot_writer ON public.systems FOR UPDATE TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot') AND (private.has_role(auth.uid(), 'super_admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role <> 'viewer'::app_role
  )))
  WITH CHECK (public.has_crm_access(auth.uid(), 'yemot'));
CREATE POLICY systems_delete_yemot_admin ON public.systems FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role IN ('admin'::app_role, 'super_admin'::app_role)
  ));

DROP POLICY IF EXISTS notes_select_all ON public.system_notes;
DROP POLICY IF EXISTS notes_insert_self ON public.system_notes;
DROP POLICY IF EXISTS notes_update_admin_or_author ON public.system_notes;
DROP POLICY IF EXISTS notes_delete_admin_or_author ON public.system_notes;
CREATE POLICY notes_select_yemot_member ON public.system_notes FOR SELECT TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot'));
CREATE POLICY notes_insert_yemot_writer ON public.system_notes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id AND public.has_crm_access(auth.uid(), 'yemot') AND EXISTS (
    SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role <> 'viewer'::app_role
  ));
CREATE POLICY notes_update_yemot_author_or_admin ON public.system_notes FOR UPDATE TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot') AND (auth.uid() = author_id OR EXISTS (
    SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role IN ('admin'::app_role, 'super_admin'::app_role)
  )));
CREATE POLICY notes_delete_yemot_author_or_admin ON public.system_notes FOR DELETE TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot') AND (auth.uid() = author_id OR EXISTS (
    SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role IN ('admin'::app_role, 'super_admin'::app_role)
  )));

DROP POLICY IF EXISTS activity_log_select_all ON public.system_activity_log;
CREATE POLICY activity_log_select_yemot_member ON public.system_activity_log FOR SELECT TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot'));

DROP POLICY IF EXISTS system_files_select_authenticated ON public.system_files;
CREATE POLICY system_files_select_yemot_member ON public.system_files FOR SELECT TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot'));

DROP POLICY IF EXISTS transfers_select_all ON public.system_transfers;
CREATE POLICY transfers_select_yemot_member ON public.system_transfers FOR SELECT TO authenticated
  USING (public.has_crm_access(auth.uid(), 'yemot'));

DROP POLICY IF EXISTS email_messages_select_all ON public.email_messages;
DROP POLICY IF EXISTS email_messages_insert_admin_or_assigned ON public.email_messages;
DROP POLICY IF EXISTS email_messages_update_admin ON public.email_messages;
DROP POLICY IF EXISTS email_messages_delete_admin ON public.email_messages;
CREATE POLICY email_messages_select_crm_member ON public.email_messages FOR SELECT TO authenticated
  USING (
    (system_id IS NOT NULL AND public.has_crm_access(auth.uid(), 'yemot')) OR
    (crm_record_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.crm_records r WHERE r.id = email_messages.crm_record_id AND public.has_crm_access(auth.uid(), r.crm_key)
    ))
  );
CREATE POLICY email_messages_insert_crm_writer ON public.email_messages FOR INSERT TO authenticated
  WITH CHECK (
    (system_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_user_roles ur WHERE ur.user_id = auth.uid() AND ur.crm_key = 'yemot' AND ur.role <> 'viewer'::app_role)) OR
    (crm_record_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.crm_records r JOIN public.crm_user_roles ur ON ur.crm_key = r.crm_key
      WHERE r.id = email_messages.crm_record_id AND ur.user_id = auth.uid() AND ur.role <> 'viewer'::app_role
    )) OR private.has_role(auth.uid(), 'super_admin'::app_role)
  );
CREATE POLICY email_messages_update_crm_admin ON public.email_messages FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role) OR
    (system_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_user_roles ur WHERE ur.user_id = auth.uid() AND ur.crm_key = 'yemot' AND ur.role IN ('admin'::app_role, 'super_admin'::app_role))) OR
    (crm_record_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_records r JOIN public.crm_user_roles ur ON ur.crm_key = r.crm_key WHERE r.id = email_messages.crm_record_id AND ur.user_id = auth.uid() AND ur.role IN ('admin'::app_role, 'super_admin'::app_role)))
  );
CREATE POLICY email_messages_delete_crm_admin ON public.email_messages FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role) OR
    (system_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_user_roles ur WHERE ur.user_id = auth.uid() AND ur.crm_key = 'yemot' AND ur.role IN ('admin'::app_role, 'super_admin'::app_role))) OR
    (crm_record_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_records r JOIN public.crm_user_roles ur ON ur.crm_key = r.crm_key WHERE r.id = email_messages.crm_record_id AND ur.user_id = auth.uid() AND ur.role IN ('admin'::app_role, 'super_admin'::app_role)))
  );

DROP POLICY IF EXISTS email_threads_select_all ON public.email_threads;
DROP POLICY IF EXISTS email_threads_insert_admin_or_assigned ON public.email_threads;
DROP POLICY IF EXISTS email_threads_delete_admin ON public.email_threads;
CREATE POLICY email_threads_select_crm_member ON public.email_threads FOR SELECT TO authenticated
  USING (
    (system_id IS NOT NULL AND public.has_crm_access(auth.uid(), 'yemot')) OR
    (crm_record_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_records r WHERE r.id = email_threads.crm_record_id AND public.has_crm_access(auth.uid(), r.crm_key)))
  );
CREATE POLICY email_threads_insert_crm_writer ON public.email_threads FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'super_admin'::app_role) OR
    (system_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_user_roles ur WHERE ur.user_id = auth.uid() AND ur.crm_key = 'yemot' AND ur.role <> 'viewer'::app_role)) OR
    (crm_record_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_records r JOIN public.crm_user_roles ur ON ur.crm_key = r.crm_key WHERE r.id = email_threads.crm_record_id AND ur.user_id = auth.uid() AND ur.role <> 'viewer'::app_role))
  );
CREATE POLICY email_threads_delete_crm_admin ON public.email_threads FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'::app_role) OR
    (system_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_user_roles ur WHERE ur.user_id = auth.uid() AND ur.crm_key = 'yemot' AND ur.role IN ('admin'::app_role, 'super_admin'::app_role))) OR
    (crm_record_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_records r JOIN public.crm_user_roles ur ON ur.crm_key = r.crm_key WHERE r.id = email_threads.crm_record_id AND ur.user_id = auth.uid() AND ur.role IN ('admin'::app_role, 'super_admin'::app_role)))
  );