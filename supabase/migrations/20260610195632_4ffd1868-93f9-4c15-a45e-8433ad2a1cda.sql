
ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS parent_system_id uuid REFERENCES public.systems(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS systems_parent_id_idx ON public.systems(parent_system_id);

-- Propagate status & assigned agent from parent to children
CREATE OR REPLACE FUNCTION public.propagate_parent_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_system_id IS NULL AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
  ) THEN
    UPDATE public.systems
       SET status = NEW.status,
           assigned_agent_id = NEW.assigned_agent_id,
           updated_at = now()
     WHERE parent_system_id = NEW.id
       AND (status IS DISTINCT FROM NEW.status OR assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS systems_propagate_to_children ON public.systems;
CREATE TRIGGER systems_propagate_to_children
AFTER UPDATE ON public.systems
FOR EACH ROW
EXECUTE FUNCTION public.propagate_parent_changes();

-- When inserting a child, inherit parent's status & agent
CREATE OR REPLACE FUNCTION public.inherit_parent_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_status system_status;
  p_agent uuid;
BEGIN
  IF NEW.parent_system_id IS NOT NULL THEN
    SELECT status, assigned_agent_id INTO p_status, p_agent
      FROM public.systems WHERE id = NEW.parent_system_id;
    NEW.status := p_status;
    NEW.assigned_agent_id := p_agent;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS systems_inherit_parent ON public.systems;
CREATE TRIGGER systems_inherit_parent
BEFORE INSERT ON public.systems
FOR EACH ROW
EXECUTE FUNCTION public.inherit_parent_on_insert();
