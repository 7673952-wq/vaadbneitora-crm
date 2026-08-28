-- 1. Fix ROW_COUNT type bug (bigint cannot be assigned to boolean)
CREATE OR REPLACE FUNCTION public.apply_request_status_change(
  _request_id uuid, _system_id uuid, _from_status text, _to_status text, _reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _rows bigint := 0;
BEGIN
  PERFORM 1 FROM public.system_requests
    WHERE id = _request_id AND status_applied_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM public.set_change_reason(_reason);
  UPDATE public.systems SET status = _to_status::system_status
    WHERE id = _system_id AND status::text = _from_status;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  IF _rows = 0 THEN RETURN false; END IF;

  UPDATE public.system_requests
    SET status_applied_at = now(), new_status = _to_status, last_completed_state = 'applied'
    WHERE id = _request_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.apply_request_status_change(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_request_status_change(uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.apply_request_status_change(uuid, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_request_status_change(uuid, uuid, text, text, text) TO service_role;

-- 2. Atomic caller-phone addition (lock system row, dedupe, stamp only on success)
CREATE OR REPLACE FUNCTION public.add_request_caller_phone(
  _request_id uuid, _system_id uuid, _phone text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  _sys public.systems%ROWTYPE;
  _exists boolean := false;
BEGIN
  IF _norm = '' THEN RETURN false; END IF;

  PERFORM 1 FROM public.system_requests
    WHERE id = _request_id AND phone_added_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO _sys FROM public.systems WHERE id = _system_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF regexp_replace(COALESCE(_sys.caller_phone, ''), '\D', '', 'g') = _norm
     OR regexp_replace(COALESCE(_sys.phone, ''), '\D', '', 'g') = _norm THEN
    _exists := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(_sys.additional_caller_phones, '[]'::jsonb)) e
      WHERE regexp_replace(COALESCE(e->>'phone', ''), '\D', '', 'g') = _norm
    ) INTO _exists;
  END IF;

  IF NOT _exists THEN
    PERFORM public.set_change_reason('הוספת מספר פונה מבקשה במייל');
    IF COALESCE(NULLIF(btrim(COALESCE(_sys.caller_phone, '')), ''), '') = '' THEN
      UPDATE public.systems SET caller_phone = _phone WHERE id = _system_id;
    ELSE
      UPDATE public.systems
        SET additional_caller_phones =
          COALESCE(additional_caller_phones, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('phone', _phone))
        WHERE id = _system_id;
    END IF;
  END IF;

  UPDATE public.system_requests SET phone_added_at = now() WHERE id = _request_id;
  RETURN NOT _exists;
END $$;

REVOKE ALL ON FUNCTION public.add_request_caller_phone(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_request_caller_phone(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.add_request_caller_phone(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_request_caller_phone(uuid, uuid, text) TO service_role;

-- 3. Record what the automation would have done (dry-run comparison)
ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS proposed_action text;

ALTER TABLE public.system_requests
  DROP CONSTRAINT IF EXISTS system_requests_proposed_action_chk;
ALTER TABLE public.system_requests
  ADD CONSTRAINT system_requests_proposed_action_chk
  CHECK (proposed_action IS NULL OR proposed_action IN ('set_status','keep','needs_decision','ignore'));

-- 4. Tighten write access: decisions go through server functions only
DROP POLICY IF EXISTS "requests decidable by crm members" ON public.system_requests;
REVOKE UPDATE ON public.system_requests FROM authenticated;

-- 5. Unique root code index: ignore leading zeros, skip codes with no digits
DROP INDEX IF EXISTS public.systems_root_code_norm_uniq;
CREATE UNIQUE INDEX systems_root_code_norm_uniq
  ON public.systems (ltrim(regexp_replace(system_code, '\D', '', 'g'), '0'))
  WHERE parent_system_id IS NULL
    AND ltrim(regexp_replace(system_code, '\D', '', 'g'), '0') <> '';