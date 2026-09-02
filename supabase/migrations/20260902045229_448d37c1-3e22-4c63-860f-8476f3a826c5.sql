ALTER TABLE public.system_requests DROP CONSTRAINT IF EXISTS system_requests_proposed_action_chk;

ALTER TABLE public.system_requests
  ADD CONSTRAINT system_requests_proposed_action_chk
  CHECK (proposed_action IS NULL OR proposed_action IN ('set_status', 'keep', 'needs_decision', 'ignore', 'create_system'));