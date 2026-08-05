ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS crm_key text;
CREATE INDEX IF NOT EXISTS email_messages_thread_idx ON public.email_messages (gmail_thread_id, created_at DESC);