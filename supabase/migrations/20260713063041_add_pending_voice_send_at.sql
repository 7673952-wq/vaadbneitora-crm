ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS pending_voice_send_at timestamptz;

CREATE INDEX IF NOT EXISTS systems_pending_voice_send_at_idx
  ON public.systems (pending_voice_send_at)
  WHERE pending_voice_send_at IS NOT NULL;
