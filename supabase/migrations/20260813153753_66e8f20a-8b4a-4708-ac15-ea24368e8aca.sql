CREATE TABLE public.api_rate_limits (
  bucket_key text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

GRANT ALL ON public.api_rate_limits TO service_role;

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only"
ON public.api_rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.bump_rate_limit(_key text, _window_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _win timestamptz;
  _hits integer;
BEGIN
  _win := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);
  INSERT INTO public.api_rate_limits (bucket_key, window_start, hits, updated_at)
  VALUES (_key, _win, 1, now())
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET hits = public.api_rate_limits.hits + 1, updated_at = now()
  RETURNING hits INTO _hits;

  DELETE FROM public.api_rate_limits WHERE window_start < now() - interval '1 day';
  RETURN _hits;
END $$;

REVOKE ALL ON FUNCTION public.bump_rate_limit(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(text, integer) TO service_role;