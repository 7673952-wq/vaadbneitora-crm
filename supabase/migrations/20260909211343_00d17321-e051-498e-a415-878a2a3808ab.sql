ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS manual_target_name text,
  ADD COLUMN IF NOT EXISTS report_description text;

CREATE OR REPLACE FUNCTION public.release_system_request_claim(_id uuid, _actor uuid, _error text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows integer;
BEGIN
  UPDATE public.system_requests
     SET decision_claim_at = NULL,
         decision_claim_by = NULL,
         manual_last_error = _error
   WHERE id = _id
     AND decision_claim_by = _actor;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.release_system_request_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_system_request_claim(uuid, uuid, text) TO service_role;