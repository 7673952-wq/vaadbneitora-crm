GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_role_defaults TO authenticated;
GRANT ALL ON public.notification_role_defaults TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_user_overrides TO authenticated;
GRANT ALL ON public.notification_user_overrides TO service_role;