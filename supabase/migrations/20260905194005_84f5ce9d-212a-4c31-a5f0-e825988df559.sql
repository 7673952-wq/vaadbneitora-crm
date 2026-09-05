ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS automation_mode text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.system_requests(id) ON DELETE SET NULL;

ALTER TABLE public.system_requests DROP CONSTRAINT IF EXISTS system_requests_mode_chk;
ALTER TABLE public.system_requests ADD CONSTRAINT system_requests_mode_chk
  CHECK (automation_mode IS NULL OR automation_mode = ANY (ARRAY['off','dry_run','live']));

ALTER TABLE public.system_requests DROP CONSTRAINT IF EXISTS system_requests_decision_chk;
ALTER TABLE public.system_requests ADD CONSTRAINT system_requests_decision_chk
  CHECK (decision_status IS NULL OR decision_status = ANY (ARRAY['auto_applied','kept','needs_decision','ignored','manual_applied','simulated','duplicate']));

-- One live request per (crm, type, system code, request number). Rows already
-- marked as duplicates are excluded so the duplicate itself can be recorded.
CREATE UNIQUE INDEX IF NOT EXISTS system_requests_dedupe_uniq
  ON public.system_requests (crm_key, request_type, system_code_norm, request_number)
  WHERE request_number IS NOT NULL
    AND btrim(request_number) <> ''
    AND system_code_norm IS NOT NULL
    AND duplicate_of IS NULL;