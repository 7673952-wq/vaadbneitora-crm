-- A real (not merely HTTP-reachable) queue health check needs to present the
-- queue's cron token to the endpoint. The token lives in private.cron_tokens
-- and must never reach the browser, so expose it to service_role ONLY; the
-- app server fetches it inside an admin-verified server function.
CREATE OR REPLACE FUNCTION public.get_cron_token(_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'private', 'public'
AS $$
  SELECT token FROM private.cron_tokens WHERE name = _name;
$$;

REVOKE ALL ON FUNCTION public.get_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_token(text) TO service_role;