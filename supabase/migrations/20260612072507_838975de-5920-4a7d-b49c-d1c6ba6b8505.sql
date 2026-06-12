
CREATE OR REPLACE FUNCTION public.set_change_reason(p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.change_reason', COALESCE(p_reason, ''), true);
END $$;

GRANT EXECUTE ON FUNCTION public.set_change_reason(text) TO authenticated;
