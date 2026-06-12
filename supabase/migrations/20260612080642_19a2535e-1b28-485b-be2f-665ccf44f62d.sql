ALTER TABLE public.system_activity_log
  ALTER COLUMN system_id DROP NOT NULL;

ALTER TABLE public.system_activity_log
  DROP CONSTRAINT IF EXISTS system_activity_log_system_id_fkey;

ALTER TABLE public.system_activity_log
  ADD CONSTRAINT system_activity_log_system_id_fkey
  FOREIGN KEY (system_id) REFERENCES public.systems(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.log_system_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_reason text;
BEGIN
  BEGIN
    v_reason := current_setting('app.change_reason', true);
  EXCEPTION WHEN OTHERS THEN
    v_reason := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_activity_log(system_id, actor_id, action, field, new_value, reason)
      VALUES (NEW.id, uid, 'created', NULL,
        COALESCE(NEW.system_code,'') || ' / ' || COALESCE(NEW.name,''), NULLIF(v_reason, ''));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'status', OLD.status::text, NEW.status::text, NULLIF(v_reason, ''));
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
        VALUES (NEW.id, uid, 'updated', 'assigned_agent_id', OLD.assigned_agent_id::text, NEW.assigned_agent_id::text, NULLIF(v_reason, ''));
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'name', OLD.name, NEW.name, NULLIF(v_reason, ''));
    END IF;
    IF NEW.notes IS DISTINCT FROM OLD.notes THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'notes', LEFT(COALESCE(OLD.notes,''),200), LEFT(COALESCE(NEW.notes,''),200), NULLIF(v_reason, ''));
    END IF;
    IF NEW.phone IS DISTINCT FROM OLD.phone THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'phone', OLD.phone, NEW.phone, NULLIF(v_reason, ''));
    END IF;
    IF NEW.caller_phone IS DISTINCT FROM OLD.caller_phone THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'caller_phone', OLD.caller_phone, NEW.caller_phone, NULLIF(v_reason, ''));
    END IF;
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'source', OLD.source, NEW.source, NULLIF(v_reason, ''));
    END IF;
    IF NEW.reminder_at IS DISTINCT FROM OLD.reminder_at THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'reminder_at', OLD.reminder_at::text, NEW.reminder_at::text, NULLIF(v_reason, ''));
    END IF;
    IF NEW.parent_system_id IS DISTINCT FROM OLD.parent_system_id THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value, reason)
        VALUES (NEW.id, uid, 'updated', 'parent_system_id', OLD.parent_system_id::text, NEW.parent_system_id::text, NULLIF(v_reason, ''));
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, reason)
      VALUES (OLD.id, uid, 'deleted', NULL,
        COALESCE(OLD.system_code,'') || ' / ' || COALESCE(OLD.name,''), NULLIF(v_reason, ''));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_system_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
BEGIN
  BEGIN
    v_reason := current_setting('app.change_reason', true);
  EXCEPTION WHEN OTHERS THEN
    v_reason := NULL;
  END;

  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    INSERT INTO public.system_transfers (system_id, from_agent_id, to_agent_id, transferred_by, reason)
    VALUES (NEW.id, OLD.assigned_agent_id, NEW.assigned_agent_id, auth.uid(), NULLIF(v_reason, ''));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS systems_touch_updated_at ON public.systems;
DROP TRIGGER IF EXISTS systems_inherit_parent_before_insert ON public.systems;
DROP TRIGGER IF EXISTS systems_propagate_parent_after_update ON public.systems;
DROP TRIGGER IF EXISTS systems_activity_log_before_update ON public.systems;
DROP TRIGGER IF EXISTS systems_activity_log_after_insert ON public.systems;
DROP TRIGGER IF EXISTS systems_activity_log_before_delete ON public.systems;
DROP TRIGGER IF EXISTS systems_activity_log_after_ins_del ON public.systems;
DROP TRIGGER IF EXISTS systems_transfer_log_after_update ON public.systems;

CREATE TRIGGER systems_inherit_parent_before_insert
  BEFORE INSERT ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.inherit_parent_on_insert();

CREATE TRIGGER systems_touch_updated_at
  BEFORE UPDATE ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER systems_activity_log_before_update
  BEFORE UPDATE ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();

CREATE TRIGGER systems_activity_log_after_insert
  AFTER INSERT ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();

CREATE TRIGGER systems_activity_log_before_delete
  BEFORE DELETE ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();

CREATE TRIGGER systems_transfer_log_after_update
  AFTER UPDATE OF assigned_agent_id ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.log_system_transfer();

CREATE TRIGGER systems_propagate_parent_after_update
  AFTER UPDATE OF status, assigned_agent_id ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.propagate_parent_changes();

CREATE POLICY "activity_log_admin_update" ON public.system_activity_log
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "activity_log_admin_delete" ON public.system_activity_log
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT UPDATE, DELETE ON public.system_activity_log TO authenticated;