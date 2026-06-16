
CREATE OR REPLACE FUNCTION public.log_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_actor_name text;
  v_target_name text;
BEGIN
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = uid;

  IF TG_OP = 'INSERT' THEN
    SELECT display_name INTO v_target_name FROM public.profiles WHERE id = NEW.user_id;
    INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value)
      VALUES (NULL, uid, v_actor_name, 'role_granted', 'user_roles',
        NULL,
        COALESCE(v_target_name, NEW.user_id::text) || ' → ' || NEW.role::text);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT display_name INTO v_target_name FROM public.profiles WHERE id = OLD.user_id;
    INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value)
      VALUES (NULL, uid, v_actor_name, 'role_revoked', 'user_roles',
        COALESCE(v_target_name, OLD.user_id::text) || ' → ' || OLD.role::text,
        NULL);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_user_role_changes_trg ON public.user_roles;
CREATE TRIGGER log_user_role_changes_trg
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_user_role_changes();
