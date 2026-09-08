CREATE OR REPLACE FUNCTION public.apply_auto_status_assignment(_system_id uuid, _agent_id uuid, _reminder_agent_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _rows bigint := 0;
BEGIN
  IF _system_id IS NULL OR _agent_id IS NULL THEN RETURN false; END IF;
  -- Marker + UPDATE must share one transaction: app.change_reason is transaction-local.
  PERFORM set_config('app.change_reason', '__auto_status_assignment__', true);
  UPDATE public.systems
     SET assigned_agent_id = _agent_id,
         reminder_agent_ids = COALESCE(_reminder_agent_ids, reminder_agent_ids)
   WHERE id = _system_id
     AND (
       assigned_agent_id IS DISTINCT FROM _agent_id
       OR (_reminder_agent_ids IS NOT NULL
           AND COALESCE(reminder_agent_ids, '{}'::uuid[]) IS DISTINCT FROM _reminder_agent_ids)
     );
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $function$;

REVOKE EXECUTE ON FUNCTION public.apply_auto_status_assignment(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_auto_status_assignment(uuid, uuid, uuid[]) TO service_role;