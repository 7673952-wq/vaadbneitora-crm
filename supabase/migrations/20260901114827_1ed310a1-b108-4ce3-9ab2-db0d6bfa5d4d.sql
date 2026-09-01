ALTER TABLE public.system_requests DROP CONSTRAINT IF EXISTS system_requests_proposed_action_chk;
ALTER TABLE public.system_requests ADD CONSTRAINT system_requests_proposed_action_chk
  CHECK (proposed_action IS NULL OR proposed_action = ANY (ARRAY['set_status','keep','needs_decision','ignore','create_system']));

CREATE OR REPLACE FUNCTION public.apply_auto_status_assignment(
  _system_id uuid,
  _agent_id uuid,
  _reminder_agent_ids uuid[] DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _rows bigint := 0;
BEGIN
  IF _system_id IS NULL OR _agent_id IS NULL THEN RETURN false; END IF;
  -- Marker + UPDATE must share one transaction: app.change_reason is transaction-local.
  PERFORM set_config('app.change_reason', '__auto_status_assignment__', true);
  UPDATE public.systems
     SET assigned_agent_id = _agent_id,
         reminder_agent_ids = COALESCE(_reminder_agent_ids, reminder_agent_ids)
   WHERE id = _system_id
     AND assigned_agent_id IS DISTINCT FROM _agent_id;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_auto_status_assignment(uuid, uuid, uuid[]) TO authenticated, service_role;