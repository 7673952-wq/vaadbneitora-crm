GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_settings TO authenticated;
GRANT ALL ON public.status_settings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

NOTIFY pgrst, 'reload schema';