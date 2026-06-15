ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.status_settings
  ADD COLUMN IF NOT EXISTS is_handled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_agent_ids uuid[] NOT NULL DEFAULT '{}';

INSERT INTO public.status_settings (status_key, label, tone, sort_order, is_custom, is_handled) VALUES
  ('pending_check_close', 'לבדיקה לחסימה', 'amber', 1, false, false),
  ('pending_check_open',  'לבדיקה לפתיחה', 'teal',  2, false, false),
  ('open',                'פתוח',          'green', 3, false, true),
  ('to_open',             'לפתוח',         'lightgreen', 4, false, false),
  ('closed',              'חסום',          'red',   5, false, true),
  ('to_block',            'לחסום',         'lightred', 6, false, false),
  ('block_from_root',     'לחסום מהשורש',  'brightred', 7, false, false),
  ('problem',             'בעיה',          'orange', 8, false, false),
  ('open_only_bimot',     'לפתוח רק בימות', 'sky',  9, false, true),
  ('close_only_bimot',    'פתוח רק בימות', 'indigo', 10, false, false),
  ('open_in_simahedrin',  'לפתיחה בסימהדרין', 'cyan', 11, false, false),
  ('close_in_simahedrin', 'לחסימה בסימהדרין', 'violet', 12, false, false),
  ('send_to_yosela',      'לשלוח ליוסלה', 'fuchsia', 13, false, false)
ON CONFLICT (status_key) DO NOTHING;