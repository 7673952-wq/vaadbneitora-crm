
CREATE TABLE public.system_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id uuid NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_files TO authenticated;
GRANT ALL ON public.system_files TO service_role;

ALTER TABLE public.system_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_files_select_authenticated
ON public.system_files FOR SELECT TO authenticated
USING (true);

CREATE POLICY system_files_insert_admin_or_assigned
ON public.system_files FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.systems s WHERE s.id = system_id AND s.assigned_agent_id = auth.uid())
);

CREATE POLICY system_files_delete_admin_or_uploader
ON public.system_files FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR uploaded_by = auth.uid()
);

CREATE INDEX system_files_system_id_idx ON public.system_files(system_id);

CREATE POLICY "Authenticated can read system-files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'system-files');

CREATE POLICY "Admins and assigned can upload system-files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'system-files');

CREATE POLICY "Admins and uploader can delete system-files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'system-files' AND (public.has_role(auth.uid(), 'admin') OR owner = auth.uid()));
