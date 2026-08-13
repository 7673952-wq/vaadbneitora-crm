REVOKE ALL ON FUNCTION public.bump_rate_limit(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_rate_limit(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.bump_rate_limit(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(text, integer) TO service_role;