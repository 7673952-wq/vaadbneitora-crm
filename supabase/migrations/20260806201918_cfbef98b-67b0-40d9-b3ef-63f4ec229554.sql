CREATE INDEX IF NOT EXISTS systems_updated_at_desc_idx
  ON public.systems (updated_at DESC);
CREATE INDEX IF NOT EXISTS systems_status_updated_idx
  ON public.systems (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS systems_secondary_status_updated_idx
  ON public.systems (secondary_status, updated_at DESC)
  WHERE secondary_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS systems_agent_updated_idx
  ON public.systems (assigned_agent_id, updated_at DESC)
  WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS systems_unread_email_idx
  ON public.systems (last_inbound_email_at DESC)
  WHERE has_unread_email = true;