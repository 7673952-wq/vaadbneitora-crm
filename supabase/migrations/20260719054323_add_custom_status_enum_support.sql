-- Custom statuses created in the admin UI ("סטטוס חדש") were only ever
-- written to the status_settings config table — they were never added to
-- the underlying `system_status` Postgres ENUM that the `systems.status`
-- column is actually constrained to. That's why assigning a system to a
-- freshly-created custom status (e.g. "problem1") failed with:
--   invalid input value for enum system_status: "problem1"
--
-- This RPC lets the server safely extend the enum whenever a genuinely new
-- custom status is created. SECURITY DEFINER so it can run the ALTER TYPE
-- (which requires elevated privileges) even though it's invoked with the
-- app's service-role key; the input is strictly validated to the same
-- [a-z0-9_]+ pattern already enforced by the Zod schema in
-- upsertStatusSetting, so this can't be used to run arbitrary SQL.
CREATE OR REPLACE FUNCTION public.add_system_status_enum_value(new_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new_value IS NULL OR new_value !~ '^[a-z0-9_]+$' OR length(new_value) > 60 THEN
    RAISE EXCEPTION 'invalid status key: %', new_value;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'system_status' AND e.enumlabel = new_value
  ) THEN
    EXECUTE format('ALTER TYPE public.system_status ADD VALUE %L', new_value);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_system_status_enum_value(text) TO service_role;

-- Backfill: add any status_key that was already saved (e.g. via the admin
-- UI, before this fix existed) but never made it into the enum.
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'status_settings') THEN
    FOR r IN SELECT DISTINCT status_key FROM public.status_settings WHERE status_key ~ '^[a-z0-9_]+$' LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'system_status' AND e.enumlabel = r.status_key
      ) THEN
        EXECUTE format('ALTER TYPE public.system_status ADD VALUE %L', r.status_key);
      END IF;
    END LOOP;
  END IF;
END $$;

