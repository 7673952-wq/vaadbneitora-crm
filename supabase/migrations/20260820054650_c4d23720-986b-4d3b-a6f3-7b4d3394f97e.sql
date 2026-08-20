CREATE TABLE public.user_security (
  user_id uuid PRIMARY KEY,
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_phone text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.user_security TO authenticated;
GRANT ALL ON public.user_security TO service_role;
ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_security_self_read" ON public.user_security FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));

CREATE TABLE public.login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  kind text NOT NULL,
  user_agent text,
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_events_created_idx ON public.login_events (created_at DESC);
GRANT SELECT ON public.login_events TO authenticated;
GRANT ALL ON public.login_events TO service_role;
ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "login_events_admin_read" ON public.login_events FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'super_admin'::app_role));

CREATE TABLE public.login_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.login_otp_challenges TO service_role;
ALTER TABLE public.login_otp_challenges ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mfa_trusted_devices (
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
GRANT ALL ON public.mfa_trusted_devices TO service_role;
ALTER TABLE public.mfa_trusted_devices ENABLE ROW LEVEL SECURITY;