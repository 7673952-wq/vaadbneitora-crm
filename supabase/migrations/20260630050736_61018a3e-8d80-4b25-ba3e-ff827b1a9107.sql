ALTER TYPE public.system_status ADD VALUE IF NOT EXISTS 'sent_to_yosela';
ALTER TYPE public.system_status ADD VALUE IF NOT EXISTS 'blocked_from_root';
ALTER TYPE public.system_status ADD VALUE IF NOT EXISTS 'send_to_committee';
ALTER TYPE public.system_status ADD VALUE IF NOT EXISTS 'sent_to_committee';
ALTER TYPE public.system_status ADD VALUE IF NOT EXISTS 'blocked_in_committee';

INSERT INTO public.status_settings (status_key, label, tone, sort_order, is_custom, is_handled) VALUES
  ('send_to_yosela',      'לשלוח ליוסלה',  'fuchsia',   130, false, false),
  ('sent_to_yosela',      'נשלח ליוסלה',   'pink',      131, false, true),
  ('blocked_from_root',   'נחסם מהשורש',   'darkred',   132, false, true),
  ('send_to_committee',   'לשלוח לוועדה',  'purple',    133, false, false),
  ('sent_to_committee',   'נשלח לוועדה',   'violet',    134, false, true),
  ('blocked_in_committee','נחסם בוועדה',   'black',     135, false, true)
ON CONFLICT (status_key) DO UPDATE SET
  label = EXCLUDED.label,
  tone = EXCLUDED.tone,
  sort_order = EXCLUDED.sort_order,
  is_custom = EXCLUDED.is_custom,
  is_handled = EXCLUDED.is_handled;

CREATE OR REPLACE FUNCTION private.inherit_parent_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p_agent uuid;
BEGIN
  IF NEW.parent_system_id IS NOT NULL AND NEW.assigned_agent_id IS NULL THEN
    SELECT assigned_agent_id INTO p_agent
      FROM public.systems WHERE id = NEW.parent_system_id;
    NEW.assigned_agent_id := p_agent;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.propagate_parent_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.parent_system_id IS NULL AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
  ) THEN
    UPDATE public.systems
       SET status = NEW.status,
           assigned_agent_id = NEW.assigned_agent_id,
           updated_at = now()
     WHERE parent_system_id = NEW.id
       AND (status IS DISTINCT FROM NEW.status OR assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id);
  END IF;
  RETURN NEW;
END
$function$;