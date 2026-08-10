WITH mapped_threads AS (
  SELECT gmail_thread_id,
         min(system_id::text)::uuid AS system_id,
         min(crm_record_id::text)::uuid AS crm_record_id
  FROM public.email_messages
  WHERE gmail_thread_id IS NOT NULL
    AND (system_id IS NOT NULL OR crm_record_id IS NOT NULL)
  GROUP BY gmail_thread_id
)
UPDATE public.email_threads t
SET system_id = coalesce(t.system_id, m.system_id),
    crm_record_id = coalesce(t.crm_record_id, m.crm_record_id)
FROM mapped_threads m
WHERE t.gmail_thread_id = m.gmail_thread_id
  AND (t.system_id IS NULL OR t.crm_record_id IS NULL);

UPDATE public.email_messages m
SET system_id = coalesce(m.system_id, t.system_id),
    crm_record_id = coalesce(m.crm_record_id, t.crm_record_id)
FROM public.email_threads t
WHERE m.gmail_thread_id = t.gmail_thread_id
  AND (m.system_id IS NULL OR m.crm_record_id IS NULL)
  AND (t.system_id IS NOT NULL OR t.crm_record_id IS NOT NULL);