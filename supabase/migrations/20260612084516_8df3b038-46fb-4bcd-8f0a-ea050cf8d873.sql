CREATE OR REPLACE FUNCTION public.update_system_status_with_reason(
  p_system_id uuid,
  p_status public.system_status,
  p_reason text
)
RETURNS public.systems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_system public.systems;
  v_updated public.systems;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT public.has_role(v_user_id, 'admin'::public.app_role)
    INTO v_is_admin;

  SELECT * INTO v_system
    FROM public.systems
   WHERE id = p_system_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'מערכת לא נמצאה';
  END IF;

  IF NOT v_is_admin AND v_system.assigned_agent_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'רק מנהל או הנציג המטפל יכולים לעדכן';
  END IF;

  UPDATE public.systems
     SET status = p_status,
         updated_at = now()
   WHERE id = p_system_id
   RETURNING * INTO v_updated;

  IF v_system.status IS DISTINCT FROM p_status AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL THEN
    UPDATE public.system_activity_log
       SET reason = btrim(p_reason)
     WHERE id = (
       SELECT id
         FROM public.system_activity_log
        WHERE system_id = p_system_id
          AND field = 'status'
          AND old_value = v_system.status::text
          AND new_value = p_status::text
        ORDER BY created_at DESC
        LIMIT 1
     );

    UPDATE public.system_activity_log AS log
       SET reason = btrim(p_reason)
      FROM public.systems AS child
     WHERE child.parent_system_id = p_system_id
       AND log.system_id = child.id
       AND log.field = 'status'
       AND log.new_value = p_status::text
       AND log.reason IS NULL
       AND log.created_at >= now() - interval '2 minutes';
  END IF;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_system_status_with_reason(uuid, public.system_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_system_status_with_reason(uuid, public.system_status, text) TO service_role;