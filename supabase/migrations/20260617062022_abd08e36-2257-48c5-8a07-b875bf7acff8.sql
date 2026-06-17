
-- ============ 1. Storage: system-files — restrict to admin/super_admin or assigned agent ============
DROP POLICY IF EXISTS "Authenticated can read system-files" ON storage.objects;
DROP POLICY IF EXISTS "Admins and assigned can upload system-files" ON storage.objects;
DROP POLICY IF EXISTS "Admins and uploader can delete system-files" ON storage.objects;

CREATE POLICY "system_files_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'system-files'
  AND (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.systems s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

CREATE POLICY "system_files_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'system-files'
  AND (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.systems s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

CREATE POLICY "system_files_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'system-files'
  AND (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR private.has_role(auth.uid(), 'super_admin'::app_role)
    OR owner = auth.uid()
  )
);

-- ============ 2. Storage: system-audio — same lockdown ============
DROP POLICY IF EXISTS "system_audio_authenticated_read" ON storage.objects;
DROP POLICY IF EXISTS "system_audio_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "system_audio_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "system_audio_authenticated_delete" ON storage.objects;

CREATE POLICY "system_audio_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'system-audio'
  AND (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.systems s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

CREATE POLICY "system_audio_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'system-audio'
  AND (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.systems s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

CREATE POLICY "system_audio_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'system-audio'
  AND (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR private.has_role(auth.uid(), 'super_admin'::app_role)
    OR owner = auth.uid()
  )
);

-- ============ 3. Unify public.has_role -> private.has_role on remaining table policies ============
DROP POLICY IF EXISTS "Admins can manage app_settings" ON public.app_settings;
CREATE POLICY "Admins can manage app_settings"
ON public.app_settings FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "system_files_insert_admin_or_assigned" ON public.system_files;
CREATE POLICY "system_files_insert_admin_or_assigned"
ON public.system_files FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'admin'::app_role)
  OR private.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.systems s
    WHERE s.id = system_files.system_id AND s.assigned_agent_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "system_files_delete_admin_or_uploader" ON public.system_files;
CREATE POLICY "system_files_delete_admin_or_uploader"
ON public.system_files FOR DELETE
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin'::app_role)
  OR private.has_role(auth.uid(), 'super_admin'::app_role)
  OR uploaded_by = auth.uid()
);
