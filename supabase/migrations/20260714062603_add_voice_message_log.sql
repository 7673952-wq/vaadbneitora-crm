CREATE TABLE IF NOT EXISTS public.voice_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id uuid REFERENCES public.systems(id) ON DELETE SET NULL,
  system_code text,
  phone text,
  phone_index integer NOT NULL DEFAULT -1,
  status_key text,
  send_mode text NOT NULL DEFAULT 'manual', -- 'manual' | 'auto' | 'queue'
  success boolean NOT NULL,
  error_message text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_message_log_created_at_idx ON public.voice_message_log (created_at DESC);
CREATE INDEX IF NOT EXISTS voice_message_log_system_id_idx ON public.voice_message_log (system_id);

GRANT SELECT ON public.voice_message_log TO authenticated;
GRANT ALL ON public.voice_message_log TO service_role;

ALTER TABLE public.voice_message_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voice_message_log_select_settings_managers" ON public.voice_message_log;
CREATE POLICY "voice_message_log_select_settings_managers"
ON public.voice_message_log FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin'::app_role)
  OR private.has_role(auth.uid(), 'super_admin'::app_role)
);
