CREATE OR REPLACE FUNCTION private.propagate_parent_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Status propagation to sub-systems is now opt-in and driven from the
  -- application layer (updateSystem accepts an explicit apply_to_children
  -- flag after the user confirms). The agent propagation stays automatic
  -- so an ownership change on a root system continues to cascade.
  IF NEW.parent_system_id IS NULL AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    UPDATE public.systems
       SET assigned_agent_id = NEW.assigned_agent_id,
           updated_at = now()
     WHERE parent_system_id = NEW.id
       AND assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id;
  END IF;
  RETURN NEW;
END $$;