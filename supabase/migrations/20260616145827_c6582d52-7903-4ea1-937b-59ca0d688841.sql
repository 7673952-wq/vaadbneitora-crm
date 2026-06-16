
ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS reminder_handled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.reset_reminder_handled_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reminder_handled := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reset_reminder_handled ON public.systems;
CREATE TRIGGER trg_reset_reminder_handled
BEFORE UPDATE ON public.systems
FOR EACH ROW EXECUTE FUNCTION public.reset_reminder_handled_on_status_change();
