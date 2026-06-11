
-- 1) Drop email column from profiles (sensitive data lives in auth.users only)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;

-- 2) Update handle_new_user trigger to not insert email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  IF (SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin') = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $function$;

-- 3) Restrict user_roles SELECT to self or admin
DROP POLICY IF EXISTS roles_select_all ON public.user_roles;
CREATE POLICY roles_select_self_or_admin
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
