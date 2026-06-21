
DROP POLICY IF EXISTS "system_files_storage_select" ON storage.objects;
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
      WHERE s.id::text = (storage.foldername(storage.objects.name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "system_files_storage_insert" ON storage.objects;
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
      WHERE s.id::text = (storage.foldername(storage.objects.name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "system_audio_storage_select" ON storage.objects;
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
      WHERE s.id::text = (storage.foldername(storage.objects.name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "system_audio_storage_insert" ON storage.objects;
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
      WHERE s.id::text = (storage.foldername(storage.objects.name))[1]
        AND s.assigned_agent_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "system_files_storage_update" ON storage.objects;
CREATE POLICY "system_files_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'system-files'
  AND (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
)
WITH CHECK (
  bucket_id = 'system-files'
  AND (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
);

DROP POLICY IF EXISTS "system_audio_storage_update" ON storage.objects;
CREATE POLICY "system_audio_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'system-audio'
  AND (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
)
WITH CHECK (
  bucket_id = 'system-audio'
  AND (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
);

DROP POLICY IF EXISTS "backups_storage_update" ON storage.objects;
CREATE POLICY "backups_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'backups'
  AND (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
)
WITH CHECK (
  bucket_id = 'backups'
  AND (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
);
