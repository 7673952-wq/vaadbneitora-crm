
-- Tighten app_settings SELECT: secrets are stored here (email_relay_secret,
-- backup_webhook_secret, voice API keys, etc.). Server functions that need
-- to expose specific fields to non-admins already do so via SECURITY DEFINER
-- paths / service-role reads, so restricting direct table reads to admins
-- does not break the app.
DROP POLICY IF EXISTS "Authenticated can read app_settings" ON public.app_settings;
CREATE POLICY "Admins can read app_settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR private.has_role(auth.uid(), 'super_admin')
  );

-- Restrict INSERT on email_messages / email_threads. The permissive
-- WITH CHECK (true) policies let any authenticated user fabricate email
-- records on any system. Only admins/super_admins or the system's assigned
-- agent may insert directly; trusted server flows continue to use the
-- service role, which bypasses RLS.
DO $$
BEGIN
  IF to_regclass('public.email_messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "email_messages_insert_all" ON public.email_messages';
    EXECUTE 'DROP POLICY IF EXISTS "email_messages_insert_admin_or_assigned" ON public.email_messages';
    EXECUTE $p$
      CREATE POLICY "email_messages_insert_admin_or_assigned"
        ON public.email_messages
        FOR INSERT
        TO authenticated
        WITH CHECK (
          private.has_role(auth.uid(), 'admin')
          OR private.has_role(auth.uid(), 'super_admin')
          OR EXISTS (
            SELECT 1 FROM public.systems s
            WHERE s.id = email_messages.system_id
              AND s.assigned_agent_id = auth.uid()
          )
        )
    $p$;
  END IF;

  IF to_regclass('public.email_threads') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "email_threads_insert_all" ON public.email_threads';
    EXECUTE 'DROP POLICY IF EXISTS "email_threads_insert_admin_or_assigned" ON public.email_threads';
    EXECUTE $p$
      CREATE POLICY "email_threads_insert_admin_or_assigned"
        ON public.email_threads
        FOR INSERT
        TO authenticated
        WITH CHECK (
          private.has_role(auth.uid(), 'admin')
          OR private.has_role(auth.uid(), 'super_admin')
          OR EXISTS (
            SELECT 1 FROM public.systems s
            WHERE s.id = email_threads.system_id
              AND s.assigned_agent_id = auth.uid()
          )
        )
    $p$;
  END IF;
END $$;
