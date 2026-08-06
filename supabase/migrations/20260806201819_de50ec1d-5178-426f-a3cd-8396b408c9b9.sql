INSERT INTO public.email_threads (gmail_thread_id, system_id, crm_record_id)
SELECT DISTINCT ON (m.gmail_thread_id)
  m.gmail_thread_id,
  m.system_id,
  m.crm_record_id
FROM public.email_messages m
WHERE m.gmail_thread_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.email_threads t
    WHERE t.gmail_thread_id = m.gmail_thread_id
  )
ORDER BY m.gmail_thread_id, m.created_at DESC;