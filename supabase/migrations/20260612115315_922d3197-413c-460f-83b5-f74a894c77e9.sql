
CREATE POLICY "Admins can read backups"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can upload backups"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete backups"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'));
