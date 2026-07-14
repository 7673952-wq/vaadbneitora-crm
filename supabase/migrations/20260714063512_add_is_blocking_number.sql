ALTER TABLE public.systems
  ADD COLUMN IF NOT EXISTS is_blocking_number boolean NOT NULL DEFAULT false;
