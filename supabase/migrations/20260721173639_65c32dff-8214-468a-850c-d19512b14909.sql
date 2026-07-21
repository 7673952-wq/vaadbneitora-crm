
-- ============================================================
-- Part 1: Re-apply schema from earlier migration files that never actually
-- ran against the live DB (idempotent — safe to re-run).
-- ============================================================

-- 20260713063041_add_pending_voice_send_at.sql
ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS pending_voice_send_at timestamptz;
CREATE INDEX IF NOT EXISTS systems_pending_voice_send_at_idx
  ON public.systems (pending_voice_send_at)
  WHERE pending_voice_send_at IS NOT NULL;

-- 20260714063512_add_is_blocking_number.sql
ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS is_blocking_number boolean NOT NULL DEFAULT false;

-- 20260714062603_add_voice_message_log.sql
CREATE TABLE IF NOT EXISTS public.voice_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id uuid REFERENCES public.systems(id) ON DELETE SET NULL,
  system_code text,
  phone text,
  phone_index integer NOT NULL DEFAULT -1,
  status_key text,
  send_mode text NOT NULL DEFAULT 'manual',
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
ON public.voice_message_log FOR SELECT TO authenticated
USING (
  private.has_role(auth.uid(), 'admin'::app_role)
  OR private.has_role(auth.uid(), 'super_admin'::app_role)
);

-- 20260719060553_email_integration.sql
CREATE TABLE IF NOT EXISTS public.email_messages (
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
CREATE INDEX IF NOT EXISTS email_messages_system_idx ON public.email_messages(system_id, created_at);
CREATE INDEX IF NOT EXISTS email_messages_thread_idx ON public.email_messages(gmail_thread_id);

DROP POLICY IF EXISTS "email_messages_select_all" ON public.email_messages;
CREATE POLICY "email_messages_select_all" ON public.email_messages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "email_messages_insert_all" ON public.email_messages;
DROP POLICY IF EXISTS "email_messages_insert_admin_or_assigned" ON public.email_messages;
CREATE POLICY "email_messages_insert_admin_or_assigned" ON public.email_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR private.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.systems s
      WHERE s.id = email_messages.system_id AND s.assigned_agent_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "email_messages_update_admin" ON public.email_messages;
CREATE POLICY "email_messages_update_admin" ON public.email_messages FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "email_messages_delete_admin" ON public.email_messages;
CREATE POLICY "email_messages_delete_admin" ON public.email_messages FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));

CREATE TABLE IF NOT EXISTS public.email_threads (
  gmail_thread_id TEXT PRIMARY KEY,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_threads TO authenticated;
GRANT ALL ON public.email_threads TO service_role;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS email_threads_system_idx ON public.email_threads(system_id);
DROP POLICY IF EXISTS "email_threads_select_all" ON public.email_threads;
CREATE POLICY "email_threads_select_all" ON public.email_threads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "email_threads_insert_all" ON public.email_threads;
DROP POLICY IF EXISTS "email_threads_insert_admin_or_assigned" ON public.email_threads;
CREATE POLICY "email_threads_insert_admin_or_assigned" ON public.email_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR private.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.systems s
      WHERE s.id = email_threads.system_id AND s.assigned_agent_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "email_threads_delete_admin" ON public.email_threads;
CREATE POLICY "email_threads_delete_admin" ON public.email_threads FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));

CREATE TABLE IF NOT EXISTS public.email_templates (
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
DROP POLICY IF EXISTS "email_templates_select_all" ON public.email_templates;
CREATE POLICY "email_templates_select_all" ON public.email_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "email_templates_write_admin" ON public.email_templates;
CREATE POLICY "email_templates_write_admin" ON public.email_templates FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_signature TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_display_name TEXT;

INSERT INTO public.app_settings (key, value) VALUES ('email_relay_url', '{"url": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_settings (key, value) VALUES ('email_relay_secret', '{"secret": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_settings (key, value) VALUES ('email_relay_address', '{"address": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.app_settings (key, value) VALUES ('email_general_name', '{"name": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS additional_emails JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- Part 2: Unread-email flow
-- ============================================================

-- Mark on the system whether it has an inbound email that hasn't been
-- opened yet. The dashboard shows a badge for this.
ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS has_unread_email boolean NOT NULL DEFAULT false;
ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS last_inbound_email_at timestamptz;

-- Admin-configured status key to auto-apply when an inbound email arrives.
-- Empty string means "don't change status automatically".
INSERT INTO public.app_settings (key, value)
VALUES ('unhandled_email_status_key', '{"status_key": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Part 3: Notification-bell preferences
-- ============================================================

-- Event catalog (fixed enum-like set of keys the app knows how to raise).
--   status_change_assigned   — status changed on a system assigned to me
--   system_assigned          — a system was newly assigned to me
--   mention                  — I was @-mentioned in a system note
--   inbound_email            — a new inbound email arrived on a system
--   waiting_overdue          — a system I'm assigned to has been "waiting" past the SLA
--   reminder_due             — a reminder I set on a system is due
--   voice_message_sent       — a voice message was successfully sent from my system
--   voice_message_failed     — a voice message failed to send

-- Role-level defaults. One row per (role, event_key).
CREATE TABLE IF NOT EXISTS public.notification_role_defaults (
  role app_role NOT NULL,
  event_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (role, event_key)
);
GRANT SELECT ON public.notification_role_defaults TO authenticated;
GRANT ALL ON public.notification_role_defaults TO service_role;
ALTER TABLE public.notification_role_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_role_defaults_read" ON public.notification_role_defaults;
CREATE POLICY "notif_role_defaults_read" ON public.notification_role_defaults
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "notif_role_defaults_admin_write" ON public.notification_role_defaults;
CREATE POLICY "notif_role_defaults_admin_write" ON public.notification_role_defaults
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));

-- Per-user overrides. NULL enabled = follow the role default.
CREATE TABLE IF NOT EXISTS public.notification_user_overrides (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_user_overrides TO authenticated;
GRANT ALL ON public.notification_user_overrides TO service_role;
ALTER TABLE public.notification_user_overrides ENABLE ROW LEVEL SECURITY;
-- Regular users can only see/edit their own overrides. Admins can manage anyone's
-- (used by the admin UI when configuring "override for a specific agent").
DROP POLICY IF EXISTS "notif_overrides_self_or_admin" ON public.notification_user_overrides;
CREATE POLICY "notif_overrides_self_or_admin" ON public.notification_user_overrides
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin')
    OR private.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin')
    OR private.has_role(auth.uid(), 'super_admin')
  );

-- Seed sensible defaults so every role has a starting configuration.
INSERT INTO public.notification_role_defaults (role, event_key, enabled) VALUES
  ('super_admin','status_change_assigned', true),
  ('super_admin','system_assigned',        true),
  ('super_admin','mention',                true),
  ('super_admin','inbound_email',          true),
  ('super_admin','waiting_overdue',        true),
  ('super_admin','reminder_due',           true),
  ('super_admin','voice_message_sent',     false),
  ('super_admin','voice_message_failed',   true),
  ('admin','status_change_assigned',       true),
  ('admin','system_assigned',              true),
  ('admin','mention',                      true),
  ('admin','inbound_email',                true),
  ('admin','waiting_overdue',              true),
  ('admin','reminder_due',                 true),
  ('admin','voice_message_sent',           false),
  ('admin','voice_message_failed',         true),
  ('agent','status_change_assigned',       true),
  ('agent','system_assigned',              true),
  ('agent','mention',                      true),
  ('agent','inbound_email',                true),
  ('agent','waiting_overdue',              true),
  ('agent','reminder_due',                 true),
  ('agent','voice_message_sent',           false),
  ('agent','voice_message_failed',         true),
  ('viewer','status_change_assigned',      false),
  ('viewer','system_assigned',             false),
  ('viewer','mention',                     true),
  ('viewer','inbound_email',               false),
  ('viewer','waiting_overdue',             false),
  ('viewer','reminder_due',                false),
  ('viewer','voice_message_sent',          false),
  ('viewer','voice_message_failed',        false)
ON CONFLICT (role, event_key) DO NOTHING;
