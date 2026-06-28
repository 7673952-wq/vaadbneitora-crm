
-- 1. Make sub-system inherit logic ONLY copy assigned_agent_id when missing.
--    Do NOT override the status that the row was inserted with — this caused
--    Excel imports to lose per-row statuses.
CREATE OR REPLACE FUNCTION private.inherit_parent_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p_agent uuid;
BEGIN
  IF NEW.parent_system_id IS NOT NULL AND NEW.assigned_agent_id IS NULL THEN
    SELECT assigned_agent_id INTO p_agent
      FROM public.systems WHERE id = NEW.parent_system_id;
    NEW.assigned_agent_id := p_agent;
  END IF;
  RETURN NEW;
END
$function$;

-- 2. Drop duplicate triggers (kept the canonical, more-specific ones).
DROP TRIGGER IF EXISTS systems_inherit_parent ON public.systems;
DROP TRIGGER IF EXISTS systems_propagate_to_children ON public.systems;
DROP TRIGGER IF EXISTS systems_log_transfer ON public.systems;
DROP TRIGGER IF EXISTS systems_touch ON public.systems;

-- Also drop the public-schema dup function that's no longer referenced.
DROP FUNCTION IF EXISTS public.inherit_parent_on_insert() CASCADE;
