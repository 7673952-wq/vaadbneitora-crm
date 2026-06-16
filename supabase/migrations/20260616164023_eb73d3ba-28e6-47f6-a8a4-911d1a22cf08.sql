
ALTER TABLE public.system_activity_log ADD COLUMN IF NOT EXISTS actor_display_name text;

UPDATE public.system_activity_log l
   SET actor_display_name = p.display_name
  FROM public.profiles p
 WHERE l.actor_id = p.id AND l.actor_display_name IS NULL;

CREATE OR REPLACE FUNCTION public.log_system_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_reason text;
  v_actor_name text;
BEGIN
  BEGIN
    v_reason := current_setting('app.change_reason', true);
  EXCEPTION WHEN OTHERS THEN
    v_reason := NULL;
  END;

  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = uid;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, new_value, reason)
      VALUES (NEW.id, uid, v_actor_name, 'created', NULL,
        COALESCE(NEW.system_code,'') || ' / ' || COALESCE(NEW.name,''), NULLIF(v_reason, ''));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'status', OLD.status::text, NEW.status::text, NULLIF(v_reason, ''));
      IF OLD.status::text IN ('pending_check_close','pending_check_open')
         AND NEW.status::text NOT IN ('pending_check_close','pending_check_open') THEN
        NEW.handled_pending_at := now();
      END IF;
      IF NEW.status::text IN ('pending_check_close','pending_check_open') THEN
        NEW.handled_pending_at := NULL;
      END IF;
    END IF;

    IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'assigned_agent_id', OLD.assigned_agent_id::text, NEW.assigned_agent_id::text, NULLIF(v_reason, ''));
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'name', OLD.name, NEW.name, NULLIF(v_reason, ''));
    END IF;
    IF NEW.notes IS DISTINCT FROM OLD.notes THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'notes', LEFT(COALESCE(OLD.notes,''),200), LEFT(COALESCE(NEW.notes,''),200), NULLIF(v_reason, ''));
    END IF;
    IF NEW.phone IS DISTINCT FROM OLD.phone THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'phone', OLD.phone, NEW.phone, NULLIF(v_reason, ''));
    END IF;
    IF NEW.caller_phone IS DISTINCT FROM OLD.caller_phone THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'caller_phone', OLD.caller_phone, NEW.caller_phone, NULLIF(v_reason, ''));
    END IF;
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'source', OLD.source, NEW.source, NULLIF(v_reason, ''));
    END IF;
    IF NEW.reminder_at IS DISTINCT FROM OLD.reminder_at THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'reminder_at', OLD.reminder_at::text, NEW.reminder_at::text, NULLIF(v_reason, ''));
    END IF;
    IF NEW.parent_system_id IS DISTINCT FROM OLD.parent_system_id THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, v_actor_name, 'updated', 'parent_system_id', OLD.parent_system_id::text, NEW.parent_system_id::text, NULLIF(v_reason, ''));
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_activity_log(system_id, actor_id, actor_display_name, action, field, old_value, reason)
      VALUES (OLD.id, uid, v_actor_name, 'deleted', NULL,
        COALESCE(OLD.system_code,'') || ' / ' || COALESCE(OLD.name,''), NULLIF(v_reason, ''));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;
