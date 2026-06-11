
-- New enum values
ALTER TYPE public.system_status ADD VALUE IF NOT EXISTS 'to_block';
ALTER TYPE public.system_status ADD VALUE IF NOT EXISTS 'to_open';

-- New columns on systems
ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handled_pending_at TIMESTAMPTZ;

-- Activity log table
CREATE TABLE IF NOT EXISTS public.system_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  actor_id UUID,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_activity_log_system_id_created_at
  ON public.system_activity_log(system_id, created_at DESC);

GRANT SELECT ON public.system_activity_log TO authenticated;
GRANT ALL ON public.system_activity_log TO service_role;
ALTER TABLE public.system_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_log_select_all
  ON public.system_activity_log
  FOR SELECT TO authenticated USING (true);

-- Trigger function to log changes and track handled-pending transitions
CREATE OR REPLACE FUNCTION public.log_system_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_activity_log(system_id, actor_id, action, field, new_value)
      VALUES (NEW.id, uid, 'created', NULL,
        COALESCE(NEW.system_code,'') || ' / ' || COALESCE(NEW.name,''));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'status', OLD.status::text, NEW.status::text);

      -- Mark handled when transitioning OUT of a pending_* status
      IF OLD.status::text IN ('pending_check_close','pending_check_open')
         AND NEW.status::text NOT IN ('pending_check_close','pending_check_open') THEN
        NEW.handled_pending_at := now();
      END IF;

      -- Reset handled marker when moving INTO a pending state
      IF NEW.status::text IN ('pending_check_close','pending_check_open') THEN
        NEW.handled_pending_at := NULL;
      END IF;
    END IF;

    IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
      INSERT INTO public.system_activity_log(system_id, actor_id, action, field, old_value, new_value)
        VALUES (NEW.id, uid, 'updated', 'assigned_agent_id',
                OLD.assigned_agent_id::text, NEW.assigned_agent_id::text);
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
END $$;

DROP TRIGGER IF EXISTS systems_activity_log ON public.systems;
CREATE TRIGGER systems_activity_log
  BEFORE INSERT OR UPDATE OR DELETE ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();
