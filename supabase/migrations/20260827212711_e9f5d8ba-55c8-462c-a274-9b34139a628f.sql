ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS name_pending boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS voice_log_dedupe_idx
  ON public.voice_message_log (system_id, status_key)
  WHERE success;