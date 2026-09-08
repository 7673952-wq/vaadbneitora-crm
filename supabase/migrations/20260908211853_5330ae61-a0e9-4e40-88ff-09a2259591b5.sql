-- Restore table privileges that were revoked too broadly.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Full CRUD for signed-in users (RLS still decides which rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systems TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_record_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_field_defs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kosher_instructions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_saved_views TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_user_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_role_defaults TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.user_security TO authenticated;

-- Append-only / read-only history tables.
GRANT SELECT, INSERT ON public.system_activity_log TO authenticated;
GRANT SELECT, INSERT ON public.system_transfers TO authenticated;
GRANT SELECT ON public.crm_record_activity TO authenticated;
GRANT SELECT ON public.login_events TO authenticated;
GRANT SELECT ON public.voice_message_log TO authenticated;

-- Server-only tables keep no user grants:
-- login_otp_challenges, mfa_grants, mfa_passed_sessions, mfa_trusted_devices,
-- api_rate_limits, system_requests, system_request_rules.