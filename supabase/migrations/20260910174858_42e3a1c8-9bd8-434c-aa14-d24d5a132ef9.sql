-- (ב) Request intent for system-name matching + soft delete. Additive only.
ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS manual_system_action text,
  ADD COLUMN IF NOT EXISTS manual_target_system_id uuid REFERENCES public.systems(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_target_parent_system_id uuid REFERENCES public.systems(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_root_confirmed_matches jsonb,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE INDEX IF NOT EXISTS system_requests_live_idx
  ON public.system_requests (crm_key, decision_status, received_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.soft_delete_system_request(_id uuid, _actor uuid, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _rows bigint := 0;
BEGIN
  IF _id IS NULL OR _actor IS NULL THEN RETURN false; END IF;
  UPDATE public.system_requests
     SET deleted_at = now(),
         deleted_by = _actor,
         delete_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
         decision_claim_at = NULL,
         decision_claim_by = NULL
   WHERE id = _id AND deleted_at IS NULL;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $$;

CREATE OR REPLACE FUNCTION public.restore_system_request(_id uuid, _actor uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _rows bigint := 0;
BEGIN
  IF _id IS NULL OR _actor IS NULL THEN RETURN false; END IF;
  UPDATE public.system_requests
     SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
   WHERE id = _id AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END $$;

REVOKE ALL ON FUNCTION public.soft_delete_system_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_system_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_system_request(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_system_request(uuid, uuid) TO service_role;