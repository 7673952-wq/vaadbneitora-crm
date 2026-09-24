-- 1. Per-attempt claim token: fences every manual-decision write.
ALTER TABLE public.system_requests ADD COLUMN IF NOT EXISTS decision_claim_token uuid;

-- 2. manual_created_system_id: clear the checkpoint when the system is deleted.
ALTER TABLE public.system_requests
  DROP CONSTRAINT IF EXISTS system_requests_manual_created_system_id_fkey;
ALTER TABLE public.system_requests
  ADD CONSTRAINT system_requests_manual_created_system_id_fkey
  FOREIGN KEY (manual_created_system_id) REFERENCES public.systems(id) ON DELETE SET NULL;

-- 3. claim_system_request: mint and return a fresh token per claim.
CREATE OR REPLACE FUNCTION public.claim_system_request(_id uuid, _actor uuid, _stale_seconds integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.system_requests%ROWTYPE;
  _token uuid := gen_random_uuid();
BEGIN
  SELECT * INTO r FROM public.system_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF r.decision_status IS NOT NULL
     AND r.decision_status NOT IN ('needs_decision', 'simulated') THEN
    RETURN NULL;
  END IF;
  IF r.decision_claim_at IS NOT NULL
     AND r.decision_claim_at > now() - make_interval(secs => GREATEST(_stale_seconds, 1)) THEN
    RETURN NULL;
  END IF;
  UPDATE public.system_requests
     SET decision_claim_at = now(), decision_claim_by = _actor, decision_claim_token = _token
   WHERE id = _id;
  r.decision_claim_at := now();
  r.decision_claim_by := _actor;
  r.decision_claim_token := _token;
  RETURN to_jsonb(r);
END $function$;

-- 4. Atomic create + checkpoint + link for a manual "open a system" decision.
CREATE OR REPLACE FUNCTION public.create_request_system(
  _request_id uuid,
  _claim_token uuid,
  _parent_system_id uuid,
  _name text,
  _name_pending boolean,
  _system_code text,
  _caller_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.system_requests%ROWTYPE;
  _new_id uuid;
  _code_norm text := ltrim(regexp_replace(COALESCE(_system_code, ''), '\D', '', 'g'), '0');
  _matches jsonb;
BEGIN
  SELECT * INTO r FROM public.system_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'הבקשה לא נמצאה'; END IF;
  IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'הבקשה נמחקה'; END IF;
  IF _claim_token IS NULL OR r.decision_claim_token IS DISTINCT FROM _claim_token THEN
    RAISE EXCEPTION 'הבקשה נמצאת בטיפול של ניסיון אחר — רענן ונסה שוב';
  END IF;

  -- Already created by this same decision: reuse it, never insert again.
  IF r.manual_created_system_id IS NOT NULL THEN
    UPDATE public.system_requests
       SET system_id = r.manual_created_system_id
     WHERE id = _request_id;
    RETURN jsonb_build_object('system_id', r.manual_created_system_id, 'created', false);
  END IF;

  BEGIN
    INSERT INTO public.systems (system_code, name, name_pending, parent_system_id, caller_phone, source)
    VALUES (COALESCE(NULLIF(btrim(_system_code), ''), _code_norm),
            _name, COALESCE(_name_pending, false), _parent_system_id,
            NULLIF(btrim(COALESCE(_caller_phone, '')), ''), 'בקשה מהמייל')
    RETURNING id INTO _new_id;
  EXCEPTION WHEN unique_violation THEN
    -- Report the CONFLICTING rows by system code, so the UI can offer to link
    -- to the existing system instead of looping on "confirm and open".
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'system_code', s.system_code)), '[]'::jsonb)
      INTO _matches
      FROM public.systems s
     WHERE _code_norm <> ''
       AND ltrim(regexp_replace(s.system_code, '\D', '', 'g'), '0') = _code_norm;
    RETURN jsonb_build_object('conflict', true, 'reason', 'system_code', 'matches', COALESCE(_matches, '[]'::jsonb));
  END;

  UPDATE public.system_requests
     SET manual_created_system_id = _new_id, system_id = _new_id
   WHERE id = _request_id;

  RETURN jsonb_build_object('system_id', _new_id, 'created', true);
END $function$;

-- 5. Atomic finalize: save the decision AND clear the intent + claim together.
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
    last_error = CASE WHEN _patch ? 'last_error' THEN _patch->>'last_error' ELSE last_error END,
    manual_last_error = CASE WHEN _patch ? 'manual_last_error' THEN _patch->>'manual_last_error' ELSE manual_last_error END,
    decided_by = COALESCE((_patch->>'decided_by')::uuid, decided_by),
    decided_at = now(),
    -- manual intent + claim are cleared ONLY here, on full success
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

-- 6. soft delete: refuse while an attempt actively holds the request.
CREATE OR REPLACE FUNCTION public.soft_delete_system_request(_id uuid, _actor uuid, _reason text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.system_requests%ROWTYPE;
  _stale_seconds integer := 300;
BEGIN
  IF _id IS NULL OR _actor IS NULL THEN RETURN false; END IF;
  SELECT * INTO r FROM public.system_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF r.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF r.decision_claim_at IS NOT NULL
     AND r.decision_claim_at > now() - make_interval(secs => _stale_seconds) THEN
    RAISE EXCEPTION 'הבקשה נמצאת כרגע בטיפול';
  END IF;

  UPDATE public.system_requests
     SET deleted_at = now(),
         deleted_by = _actor,
         delete_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
         -- a stale claim is released, and its token invalidated so the old
         -- attempt can no longer write to this request
         decision_claim_at = NULL,
         decision_claim_by = NULL,
         decision_claim_token = NULL
   WHERE id = _id;
  RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public.create_request_system(uuid, uuid, uuid, text, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_system_request(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_request_system(uuid, uuid, uuid, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_system_request(uuid, uuid, jsonb) TO service_role;