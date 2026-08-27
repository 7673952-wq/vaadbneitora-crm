-- 1. Root systems: no two parents with the same normalized code
CREATE UNIQUE INDEX IF NOT EXISTS systems_root_code_norm_uniq
  ON public.systems (regexp_replace(system_code, '\D', '', 'g'))
  WHERE parent_system_id IS NULL;

-- 2. Rules table
CREATE TABLE IF NOT EXISTS public.system_request_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_key text NOT NULL DEFAULT 'yemot',
  request_type text NOT NULL,
  from_status text,
  action text NOT NULL,
  to_status text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rules_type_chk CHECK (request_type IN ('pticha','sgira')),
  CONSTRAINT rules_action_chk CHECK (action IN ('set_status','keep','needs_decision','ignore')),
  CONSTRAINT rules_to_status_chk CHECK (action <> 'set_status' OR to_status IS NOT NULL)
);

GRANT SELECT ON public.system_request_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.system_request_rules TO authenticated;
GRANT ALL ON public.system_request_rules TO service_role;
ALTER TABLE public.system_request_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rules readable by crm members" ON public.system_request_rules
  FOR SELECT TO authenticated
  USING (public.has_crm_access(auth.uid(), crm_key));

CREATE POLICY "rules managed by settings managers" ON public.system_request_rules
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));

CREATE UNIQUE INDEX IF NOT EXISTS system_request_rules_active_uniq
  ON public.system_request_rules (crm_key, request_type, from_status)
  NULLS NOT DISTINCT
  WHERE is_active;

CREATE TRIGGER system_request_rules_touch
  BEFORE UPDATE ON public.system_request_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Requests table
CREATE TABLE IF NOT EXISTS public.system_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_key text NOT NULL DEFAULT 'yemot',
  gmail_message_id text NOT NULL,
  gmail_thread_id text,
  request_type text NOT NULL,
  request_number text,
  system_code_raw text,
  system_code_norm text,
  caller_phone text,
  caller_phone_norm text,
  system_id uuid REFERENCES public.systems(id) ON DELETE SET NULL,
  processing_state text NOT NULL DEFAULT 'received',
  last_completed_state text NOT NULL DEFAULT 'none',
  decision_status text,
  dry_run boolean NOT NULL DEFAULT false,
  rule_id uuid REFERENCES public.system_request_rules(id) ON DELETE SET NULL,
  prev_status text,
  proposed_status text,
  new_status text,
  status_applied_at timestamptz,
  phone_added_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  error_at timestamptz,
  attachment_name text,
  attachment_index int,
  subject text,
  decided_by uuid,
  decided_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_requests_gmail_message_id_key UNIQUE (gmail_message_id),
  CONSTRAINT system_requests_type_chk CHECK (request_type IN ('pticha','sgira')),
  CONSTRAINT system_requests_state_chk CHECK (processing_state IN ('received','parsed','matched','done','failed')),
  CONSTRAINT system_requests_last_chk CHECK (last_completed_state IN ('none','parsed','matched','applied')),
  CONSTRAINT system_requests_decision_chk CHECK (decision_status IS NULL OR decision_status IN
    ('auto_applied','kept','needs_decision','ignored','manual_applied'))
);

GRANT SELECT, UPDATE ON public.system_requests TO authenticated;
GRANT ALL ON public.system_requests TO service_role;
ALTER TABLE public.system_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "requests readable by crm members" ON public.system_requests
  FOR SELECT TO authenticated
  USING (public.has_crm_access(auth.uid(), crm_key));

CREATE POLICY "requests decidable by crm members" ON public.system_requests
  FOR UPDATE TO authenticated
  USING (public.has_crm_access(auth.uid(), crm_key))
  WITH CHECK (public.has_crm_access(auth.uid(), crm_key));

CREATE INDEX IF NOT EXISTS system_requests_queue_idx ON public.system_requests (crm_key, decision_status, received_at DESC);
CREATE INDEX IF NOT EXISTS system_requests_state_idx ON public.system_requests (processing_state) WHERE processing_state <> 'done';
CREATE INDEX IF NOT EXISTS system_requests_system_idx ON public.system_requests (system_id, received_at DESC);
CREATE INDEX IF NOT EXISTS system_requests_code_idx ON public.system_requests (system_code_norm);

CREATE TRIGGER system_requests_touch
  BEFORE UPDATE ON public.system_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Atomic status change driven by a request (compare-and-set + idempotency)
CREATE OR REPLACE FUNCTION public.apply_request_status_change(
  _request_id uuid, _system_id uuid, _from_status text, _to_status text, _reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ok boolean := false;
BEGIN
  PERFORM 1 FROM public.system_requests
    WHERE id = _request_id AND status_applied_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM public.set_change_reason(_reason);
  UPDATE public.systems SET status = _to_status::system_status
    WHERE id = _system_id AND status::text = _from_status;
  GET DIAGNOSTICS _ok = ROW_COUNT;
  IF NOT _ok THEN RETURN false; END IF;

  UPDATE public.system_requests
    SET status_applied_at = now(), new_status = _to_status, last_completed_state = 'applied'
    WHERE id = _request_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.apply_request_status_change(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_request_status_change(uuid, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_request_status_change(uuid, uuid, text, text, text) TO service_role;