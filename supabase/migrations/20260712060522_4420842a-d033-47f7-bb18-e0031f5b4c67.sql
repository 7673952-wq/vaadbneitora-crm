DO $$
DECLARE
  column_type text;
  column_udt text;
BEGIN
  SELECT data_type, udt_name
    INTO column_type, column_udt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'systems'
     AND column_name = 'additional_caller_phones';

  IF column_type IS NULL THEN
    ALTER TABLE public.systems
      ADD COLUMN additional_caller_phones jsonb NOT NULL DEFAULT '[]'::jsonb;
  ELSIF column_udt <> 'jsonb' THEN
    ALTER TABLE public.systems
      ADD COLUMN IF NOT EXISTS additional_caller_phones_fixed jsonb NOT NULL DEFAULT '[]'::jsonb;

    IF column_udt = '_text' THEN
      EXECUTE $fix_text_array$
        UPDATE public.systems
           SET additional_caller_phones_fixed = COALESCE((
             SELECT jsonb_agg(
               CASE
                 WHEN elem.value ~ '^\s*\{.*\}\s*$' OR elem.value ~ '^\s*\[.*\]\s*$'
                   THEN elem.value::jsonb
                 ELSE jsonb_build_object('phone', elem.value)
               END
             )
             FROM unnest(additional_caller_phones) AS elem(value)
             WHERE NULLIF(trim(elem.value), '') IS NOT NULL
           ), '[]'::jsonb)
      $fix_text_array$;
    ELSE
      EXECUTE $fix_other$
        UPDATE public.systems
           SET additional_caller_phones_fixed = COALESCE(to_jsonb(additional_caller_phones), '[]'::jsonb)
      $fix_other$;
    END IF;

    ALTER TABLE public.systems DROP COLUMN additional_caller_phones;
    ALTER TABLE public.systems RENAME COLUMN additional_caller_phones_fixed TO additional_caller_phones;
    ALTER TABLE public.systems ALTER COLUMN additional_caller_phones SET DEFAULT '[]'::jsonb;
    ALTER TABLE public.systems ALTER COLUMN additional_caller_phones SET NOT NULL;
  END IF;
END $$;

ALTER TABLE public.systems DROP CONSTRAINT IF EXISTS systems_system_code_key;
DROP INDEX IF EXISTS public.systems_system_code_key;
DROP INDEX IF EXISTS public.systems_root_system_code_unique;
CREATE UNIQUE INDEX systems_root_system_code_unique
  ON public.systems (system_code)
  WHERE parent_system_id IS NULL;