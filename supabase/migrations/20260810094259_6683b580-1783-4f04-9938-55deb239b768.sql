WITH unique_system_emails AS (
  SELECT lower(trim(email)) AS email, min(id::text)::uuid AS system_id
  FROM public.systems
  WHERE email IS NOT NULL AND trim(email) <> ''
  GROUP BY lower(trim(email))
  HAVING count(*) = 1
), thread_system_matches AS (
  SELECT m.gmail_thread_id, min(u.system_id::text)::uuid AS system_id
  FROM public.email_messages m
  JOIN unique_system_emails u
    ON lower(coalesce(m.from_address, '')) LIKE '%' || u.email || '%'
    OR lower(coalesce(m.to_address, '')) LIKE '%' || u.email || '%'
  WHERE m.gmail_thread_id IS NOT NULL
  GROUP BY m.gmail_thread_id
  HAVING count(DISTINCT u.system_id) = 1
)
UPDATE public.email_threads t
SET system_id = x.system_id
FROM thread_system_matches x
WHERE t.gmail_thread_id = x.gmail_thread_id
  AND t.system_id IS NULL
  AND t.crm_record_id IS NULL;

WITH unique_record_emails AS (
  SELECT lower(trim(email)) AS email, min(id::text)::uuid AS record_id
  FROM public.crm_records
  WHERE email IS NOT NULL AND trim(email) <> ''
  GROUP BY lower(trim(email))
  HAVING count(*) = 1
), thread_record_matches AS (
  SELECT m.gmail_thread_id, min(u.record_id::text)::uuid AS record_id
  FROM public.email_messages m
  JOIN unique_record_emails u
    ON lower(coalesce(m.from_address, '')) LIKE '%' || u.email || '%'
    OR lower(coalesce(m.to_address, '')) LIKE '%' || u.email || '%'
  WHERE m.gmail_thread_id IS NOT NULL
  GROUP BY m.gmail_thread_id
  HAVING count(DISTINCT u.record_id) = 1
)
UPDATE public.email_threads t
SET crm_record_id = x.record_id
FROM thread_record_matches x
WHERE t.gmail_thread_id = x.gmail_thread_id
  AND t.system_id IS NULL
  AND t.crm_record_id IS NULL;

UPDATE public.email_messages m
SET system_id = t.system_id,
    crm_record_id = t.crm_record_id
FROM public.email_threads t
WHERE m.gmail_thread_id = t.gmail_thread_id
  AND m.system_id IS NULL
  AND m.crm_record_id IS NULL
  AND (t.system_id IS NOT NULL OR t.crm_record_id IS NOT NULL);