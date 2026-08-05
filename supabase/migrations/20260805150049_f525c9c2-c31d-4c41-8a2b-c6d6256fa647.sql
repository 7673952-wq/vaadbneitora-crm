ALTER TABLE public.email_messages DROP CONSTRAINT IF EXISTS email_messages_owner_check;
ALTER TABLE public.email_messages ADD CONSTRAINT email_messages_owner_check
  CHECK ((((system_id IS NOT NULL))::integer + ((crm_record_id IS NOT NULL))::integer) <= 1);