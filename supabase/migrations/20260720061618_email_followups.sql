-- Bugfix: public.has_role() had EXECUTE revoked from `authenticated` in an
-- earlier migration (20260612094014) in favor of private.has_role(), but
-- the email_* RLS policies (20260719060553_email_integration.sql) were
-- written against public.has_role() — causing "permission denied for
-- function has_role" for any regular agent trying to write a template.

DROP POLICY IF EXISTS "email_messages_update_admin" ON public.email_messages;
CREATE POLICY "email_messages_update_admin" ON public.email_messages FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "email_messages_delete_admin" ON public.email_messages;
CREATE POLICY "email_messages_delete_admin" ON public.email_messages FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "email_threads_delete_admin" ON public.email_threads;
CREATE POLICY "email_threads_delete_admin" ON public.email_threads FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "email_templates_write_admin" ON public.email_templates;
CREATE POLICY "email_templates_write_admin" ON public.email_templates FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Additional email addresses on a system, alongside caller_phone/email —
-- same jsonb-array-of-objects shape as additional_caller_phones.
ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS additional_emails JSONB NOT NULL DEFAULT '[]'::jsonb;

-- "General" outgoing display name (e.g. "ועד בני תורה" / "משרד"), selectable
-- as an alternative to the agent's personal name when composing an email.
INSERT INTO public.app_settings (key, value) VALUES ('email_general_name', '{"name": ""}'::jsonb) ON CONFLICT (key) DO NOTHING;
