CREATE OR REPLACE FUNCTION public.finalize_system_request(
  _request_id uuid,
  _claim_token uuid,
  _patch jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.system_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.system_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'הבקשה לא נמצאה'; END IF;
  IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'לא ניתן לסיים בקשה שנמחקה'; END IF;
  IF _claim_token IS NULL OR r.decision_claim_token IS DISTINCT FROM _claim_token THEN
    RAISE EXCEPTION 'הבקשה נמצאת בטיפול של ניסיון אחר — רענן ונסה שוב';
  END IF;

  UPDATE public.system_requests SET
    decision_status = COALESCE(_patch->>'decision_status', decision_status),
    processing_state = COALESCE(_patch->>'processing_state', processing_state),
    last_completed_state = COALESCE(_patch->>'last_completed_state', last_completed_state),
    new_status = COALESCE(_patch->>'new_status', new_status),
    status_applied_at = COALESCE((_patch->>'status_applied_at')::timestamptz, status_applied_at),
    side_effects_completed_at = COALESCE((_patch->>'side_effects_completed_at')::timestamptz, side_effects_completed_at),
    proposed_action = COALESCE(_patch->>'proposed_action', proposed_action),
    proposed_status = COALESCE(_patch->>'proposed_status', proposed_status),
    dry_run = CASE WHEN _patch ? 'dry_run' THEN (_patch->>'dry_run')::boolean ELSE dry_run END,
    last_error = CASE WHEN _patch ? 'last_error' THEN _patch->>'last_error' ELSE last_error END,
    manual_last_error = CASE WHEN _patch ? 'manual_last_error' THEN _patch->>'manual_last_error' ELSE manual_last_error END,
    decided_by = COALESCE((_patch->>'decided_by')::uuid, decided_by),
    decided_at = now(),
    manual_action = NULL,
    manual_target_status = NULL,
    manual_target_name = NULL,
    manual_system_action = NULL,
    manual_target_system_id = NULL,
    manual_target_parent_system_id = NULL,
    manual_root_confirmed_matches = NULL,
    manual_created_system_id = NULL,
    manual_started_by = NULL,
    manual_started_at = NULL,
    decision_claim_at = NULL,
    decision_claim_by = NULL,
    decision_claim_token = NULL
  WHERE id = _request_id;

  RETURN true;
END $function$;

REVOKE EXECUTE ON FUNCTION public.finalize_system_request(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_system_request(uuid, uuid, jsonb) TO service_role;