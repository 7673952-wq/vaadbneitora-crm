-- 1) Requests tables are server-function only from now on.
DROP POLICY IF EXISTS "requests readable by crm members" ON public.system_requests;
DROP POLICY IF EXISTS "rules readable by crm members" ON public.system_request_rules;
DROP POLICY IF EXISTS "rules managed by settings managers" ON public.system_request_rules;

REVOKE ALL ON public.system_requests FROM authenticated, anon;
REVOKE ALL ON public.system_request_rules FROM authenticated, anon;
GRANT ALL ON public.system_requests TO service_role;
GRANT ALL ON public.system_request_rules TO service_role;

ALTER TABLE public.system_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_request_rules ENABLE ROW LEVEL SECURITY;

-- 2) New columns for the label-derived type and idempotent side effects.
ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS source_request_type text,
  ADD COLUMN IF NOT EXISTS side_effects_completed_at timestamptz;

-- 3) Efficient lookup by the shared match key (digits, no leading zeros).
CREATE INDEX IF NOT EXISTS systems_code_match_key_idx
  ON public.systems ((ltrim(regexp_replace(system_code, '\D', '', 'g'), '0')));

CREATE OR REPLACE FUNCTION public.find_systems_by_code_key(_key text)
RETURNS TABLE (
  id uuid,
  system_code text,
  name text,
  status text,
  caller_phone text,
  phone text,
  additional_caller_phones jsonb,
  parent_system_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.system_code, s.name, s.status::text, s.caller_phone, s.phone,
         s.additional_caller_phones, s.parent_system_id
  FROM public.systems s
  WHERE NULLIF(_key, '') IS NOT NULL
    AND ltrim(regexp_replace(s.system_code, '\D', '', 'g'), '0') = ltrim(regexp_replace(_key, '\D', '', 'g'), '0')
  ORDER BY (s.parent_system_id IS NULL) DESC, s.created_at ASC
$$;

REVOKE ALL ON FUNCTION public.find_systems_by_code_key(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_systems_by_code_key(text) TO service_role;