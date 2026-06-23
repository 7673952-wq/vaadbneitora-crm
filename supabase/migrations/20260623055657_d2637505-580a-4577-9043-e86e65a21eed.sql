CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS systems_name_trgm_idx
  ON public.systems USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS systems_name_lower_idx
  ON public.systems (lower(name));