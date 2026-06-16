ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
CREATE INDEX IF NOT EXISTS idx_systems_snoozed_until ON public.systems(snoozed_until);