CREATE OR REPLACE FUNCTION public.inherit_parent_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_agent uuid;
BEGIN
  IF NEW.parent_system_id IS NOT NULL AND NEW.assigned_agent_id IS NULL THEN
    SELECT assigned_agent_id INTO p_agent
      FROM public.systems WHERE id = NEW.parent_system_id;
    NEW.assigned_agent_id := p_agent;
  END IF;
  RETURN NEW;
END $$;