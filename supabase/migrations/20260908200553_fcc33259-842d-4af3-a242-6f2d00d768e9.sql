DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.tablename);
  END LOOP;
END $$;

REVOKE ALL ON public.mfa_grants FROM authenticated;
REVOKE ALL ON public.mfa_passed_sessions FROM authenticated;
REVOKE ALL ON public.mfa_trusted_devices FROM authenticated;
REVOKE ALL ON public.login_otp_challenges FROM authenticated;
REVOKE ALL ON public.api_rate_limits FROM authenticated;

GRANT ALL ON public.mfa_grants TO service_role;
GRANT ALL ON public.mfa_passed_sessions TO service_role;
GRANT ALL ON public.mfa_trusted_devices TO service_role;
GRANT ALL ON public.login_otp_challenges TO service_role;
GRANT ALL ON public.api_rate_limits TO service_role;