ALTER TABLE public.systems DROP CONSTRAINT IF EXISTS systems_system_code_key;
DROP INDEX IF EXISTS public.systems_system_code_key;
CREATE UNIQUE INDEX systems_root_system_code_unique ON public.systems (system_code) WHERE parent_system_id IS NULL;