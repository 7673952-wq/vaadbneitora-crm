
-- Add caller info & reminder targeting to systems
ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS caller_phone text,
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS reminder_agent_ids uuid[] DEFAULT '{}'::uuid[];

-- Reason field on activity log
ALTER TABLE public.system_activity_log
  ADD COLUMN IF NOT EXISTS reason text;

-- Recreate change-logger to capture reason via session GUC and to skip phone log when phone is null
CREATE OR REPLACE FUNCTION public.log_system_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid UUID := auth.uid();
  v_reason text;
BEGIN
  BEGIN
    v_reason := current_setting('app.change_reason', true);
  EXCEPTION WHEN OTHERS THEN v_reason := NULL; END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_activity_log(system_id, actor_id, action, field, new_value, reason)
      VALUES (NEW.id, uid, 'created', NULL,
        COALESCE(NEW.system_code,'') || ' / ' || COALESCE(NEW.name,''), v_reason);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'status', OLD.status::text, NEW.status::text, v_reason);
      IF OLD.status::text IN ('pending_check_close','pending_check_open')
         AND NEW.status::text NOT IN ('pending_check_close','pending_check_open') THEN
        NEW.handled_pending_at := now();
      END IF;
      IF NEW.status::text IN ('pending_check_close','pending_check_open') THEN
        NEW.handled_pending_at := NULL;
      END IF;
    END IF;

    IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'assigned_agent_id',
                OLD.assigned_agent_id::text, NEW.assigned_agent_id::text, v_reason);
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'name', OLD.name, NEW.name);
    END IF;
    IF NEW.notes IS DISTINCT FROM OLD.notes THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'notes', LEFT(COALESCE(OLD.notes,''),200), LEFT(COALESCE(NEW.notes,''),200));
    END IF;
    IF NEW.phone IS DISTINCT FROM OLD.phone THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'phone', OLD.phone, NEW.phone);
    END IF;
    IF NEW.caller_phone IS DISTINCT FROM OLD.caller_phone THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'caller_phone', OLD.caller_phone, NEW.caller_phone);
    END IF;
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'source', OLD.source, NEW.source);
    END IF;
    IF NEW.reminder_at IS DISTINCT FROM OLD.reminder_at THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'reminder_at',
                OLD.reminder_at::text, NEW.reminder_at::text);
    END IF;
    IF NEW.parent_system_id IS DISTINCT FROM OLD.parent_system_id THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'parent_system_id',
                OLD.parent_system_id::text, NEW.parent_system_id::text);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value)
      VALUES (OLD.id, uid, 'deleted', NULL,
        COALESCE(OLD.system_code,'') || ' / ' || COALESCE(OLD.name,''));
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- Allow authenticated users to call set_config for reason (already permitted by default, but ensure exec is OK)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
