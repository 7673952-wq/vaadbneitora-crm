CREATE TABLE IF NOT EXISTS public.mail_thread_state (
  thread_id text PRIMARY KEY,
  starred boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  spam boolean NOT NULL DEFAULT false,
  trashed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.mail_thread_state TO authenticated;
GRANT ALL ON public.mail_thread_state TO service_role;

ALTER TABLE public.mail_thread_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mail_thread_state_read_members" ON public.mail_thread_state
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_user_roles r WHERE r.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS mail_thread_state_flags_idx
  ON public.mail_thread_state (archived, spam, trashed);