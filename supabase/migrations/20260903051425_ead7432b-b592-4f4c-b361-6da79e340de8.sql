ALTER TABLE public.system_requests ALTER COLUMN request_type DROP NOT NULL;

ALTER TABLE public.system_requests DROP CONSTRAINT IF EXISTS system_requests_type_chk;
ALTER TABLE public.system_requests ADD CONSTRAINT system_requests_type_chk
  CHECK (request_type IS NULL OR request_type = ANY (ARRAY['pticha'::text, 'sgira'::text]));

ALTER TABLE public.system_requests DROP CONSTRAINT IF EXISTS system_requests_decision_chk;
ALTER TABLE public.system_requests ADD CONSTRAINT system_requests_decision_chk
  CHECK (decision_status IS NULL OR decision_status = ANY (ARRAY[
    'auto_applied'::text, 'kept'::text, 'needs_decision'::text,
    'ignored'::text, 'manual_applied'::text, 'simulated'::text]));