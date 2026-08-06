ALTER TABLE public.email_messages
  DROP CONSTRAINT IF EXISTS email_messages_owner_check;
ALTER TABLE public.email_messages
  ADD CONSTRAINT email_messages_owner_check
  CHECK ((system_id IS NOT NULL)::integer + (crm_record_id IS NOT NULL)::integer <= 1);

ALTER TABLE public.email_threads
  DROP CONSTRAINT IF EXISTS email_threads_owner_check;
ALTER TABLE public.email_threads
  ADD CONSTRAINT email_threads_owner_check
  CHECK ((system_id IS NOT NULL)::integer + (crm_record_id IS NOT NULL)::integer <= 1);

DROP POLICY IF EXISTS email_messages_select_crm_member ON public.email_messages;
CREATE POLICY email_messages_select_crm_member
ON public.email_messages
FOR SELECT
TO authenticated
USING (
  (system_id IS NULL AND crm_record_id IS NULL)
  OR (system_id IS NOT NULL AND public.has_crm_access(auth.uid(), 'yemot'))
  OR (crm_record_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.crm_records r
    WHERE r.id = email_messages.crm_record_id
      AND public.has_crm_access(auth.uid(), r.crm_key)
  ))
);

DROP POLICY IF EXISTS email_threads_select_crm_member ON public.email_threads;
CREATE POLICY email_threads_select_crm_member
ON public.email_threads
FOR SELECT
TO authenticated
USING (
  (system_id IS NULL AND crm_record_id IS NULL)
  OR (system_id IS NOT NULL AND public.has_crm_access(auth.uid(), 'yemot'))
  OR (crm_record_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.crm_records r
    WHERE r.id = email_threads.crm_record_id
      AND public.has_crm_access(auth.uid(), r.crm_key)
  ))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_threads TO authenticated;
GRANT ALL ON public.email_threads TO service_role;