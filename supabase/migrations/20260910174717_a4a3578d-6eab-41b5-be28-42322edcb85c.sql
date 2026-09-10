-- (א) Effective-privilege hardening. Additive only: no table/policy is edited.

-- 1. Privileges that bypass RLS and are never used through the Data API.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.%I FROM anon, authenticated', r.relname);
  END LOOP;
END $$;

-- 2. SECURITY INVOKER report functions: explicit grants, nothing for PUBLIC/anon.
REVOKE EXECUTE ON FUNCTION public.list_systems_page(text[], text[], uuid, timestamp with time zone, timestamp with time zone, integer, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reports_summary(text, uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.systems_status_counts(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_systems_page(text[], text[], uuid, timestamp with time zone, timestamp with time zone, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reports_summary(text, uuid, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.systems_status_counts(uuid, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;

-- 3. mail_thread_state is read and written only by server functions (service_role).
REVOKE ALL ON public.mail_thread_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mail_thread_state TO service_role;

-- 4. profiles: table-level grants made the column grants meaningless.
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, display_name, email_display_name, created_at) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;