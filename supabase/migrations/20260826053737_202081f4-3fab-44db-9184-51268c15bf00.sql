-- Session-bound MFA proof, accessible ONLY to the service role (no browser access).
CREATE TABLE public.mfa_passed_sessions (
  session_id text NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
GRANT ALL ON public.mfa_passed_sessions TO service_role;
ALTER TABLE public.mfa_passed_sessions ENABLE ROW LEVEL SECURITY;

-- One-time, short-lived MFA grants: created after a verified OTP, exchanged for
-- an mfa_passed_sessions row by confirmMfaSession. Hash only, never the grant.
CREATE TABLE public.mfa_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.mfa_grants TO service_role;
ALTER TABLE public.mfa_grants ENABLE ROW LEVEL SECURITY;

-- Resend state machine + counter on OTP challenges.
ALTER TABLE public.login_otp_challenges
  ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'active';

-- Indexes for login-path lookups.
CREATE INDEX IF NOT EXISTS login_otp_challenges_user_idx ON public.login_otp_challenges (user_id);
CREATE INDEX IF NOT EXISTS login_otp_challenges_expires_idx ON public.login_otp_challenges (expires_at);
CREATE INDEX IF NOT EXISTS login_events_user_created_idx ON public.login_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mfa_trusted_devices_expires_idx ON public.mfa_trusted_devices (expires_at);
CREATE INDEX IF NOT EXISTS mfa_passed_sessions_expires_idx ON public.mfa_passed_sessions (expires_at);
CREATE INDEX IF NOT EXISTS mfa_grants_user_idx ON public.mfa_grants (user_id);