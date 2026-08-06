CREATE INDEX IF NOT EXISTS email_messages_created_at_desc_idx
  ON public.email_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_thread_created_idx
  ON public.email_messages (gmail_thread_id, created_at DESC)
  WHERE gmail_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_messages_unread_inbound_idx
  ON public.email_messages (created_at DESC)
  WHERE read_at IS NULL AND direction IN ('in', 'inbound');