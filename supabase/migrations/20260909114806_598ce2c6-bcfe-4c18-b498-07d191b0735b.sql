ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS manual_action text,
  ADD COLUMN IF NOT EXISTS manual_target_status text,
  ADD COLUMN IF NOT EXISTS manual_started_by uuid,
  ADD COLUMN IF NOT EXISTS manual_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS manual_last_error text;

COMMENT ON COLUMN public.system_requests.manual_action IS
  'Intent of the manual decision that won the claim. A retry resumes THIS action and never infers a new one from current state.';

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start
  ON public.api_rate_limits (window_start);