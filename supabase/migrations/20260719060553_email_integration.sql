-- Email integration: lets agents send/receive email from a shared Gmail
-- mailbox directly from a system's card, threaded per Gmail's own
-- Thread-Id/Message-Id (so it survives subject changes / Re:/Fwd:), with
-- each agent's own display name + personal signature on outgoing mail.
-- Sending/receiving itself happens via a Google Apps Script Web App acting
-- as a relay (see the .gs file) — this table is the CRM-side mirror of
-- that thread.

CREATE TABLE public.email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  gmail_thread_id TEXT,
  gmail_message_id TEXT,
  in_reply_to TEXT,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_name TEXT,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX email_messages_system_idx ON public.email_messages(system_id, created_at);
CREATE INDEX email_messages_thread_idx ON public.email_messages(gmail_thread_id);

CREATE POLICY "email_messages_select_all" ON public.email_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "email_messages_insert_all" ON public.email_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "email_messages_update_admin" ON public.email_messages FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "email_messages_delete_admin" ON public.email_messages FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Track the "system this Gmail thread belongs to" so the inbound-scanning
-- Apps Script trigger (or the webhook handler) can resolve a reply back to
-- the right system purely by gmail_thread_id, without depending on subject
-- text at all.
CREATE TABLE public.email_threads (
  gmail_thread_id TEXT PRIMARY KEY,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_threads TO authenticated;
GRANT ALL ON public.email_threads TO service_role;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
CREATE INDEX email_threads_system_idx ON public.email_threads(system_id);
CREATE POLICY "email_threads_select_all" ON public.email_threads FOR SELECT TO authenticated USING (true);
CREATE POLICY "email_threads_insert_all" ON public.email_threads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "email_threads_delete_admin" ON public.email_threads FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Ready-made email templates (subject + body), selectable when composing
-- from a system card. {{system_code}}, {{system_name}}, {{caller_phone}},
-- {{agent_name}} placeholders are filled in client-side before sending.
CREATE TABLE public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_templates_select_all" ON public.email_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "email_templates_write_admin" ON public.email_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Per-agent outgoing display name + personal signature (shown as the "From"
-- name and appended to every outgoing email, even though all mail is sent
-- through the same shared Gmail address).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_signature TEXT;

-- Connection settings for the Apps Script relay (URL + shared secret) and
-- the shared mailbox address, filled in once from ניהול → מיילים.
INSERT INTO public.app_settings (key, value) VALUES ('email_relay_url', '{"url": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_settings (key, value) VALUES ('email_relay_secret', '{"secret": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_settings (key, value) VALUES ('email_relay_address', '{"address": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;
