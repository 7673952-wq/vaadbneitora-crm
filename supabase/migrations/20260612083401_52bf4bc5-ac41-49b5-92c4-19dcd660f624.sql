
CREATE TABLE public.status_settings (
  status_key text PRIMARY KEY,
  label text NOT NULL,
  tone text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_custom boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_settings TO authenticated;
GRANT ALL ON public.status_settings TO service_role;

ALTER TABLE public.status_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "status_settings_read_all_auth"
  ON public.status_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "status_settings_admin_insert"
  ON public.status_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "status_settings_admin_update"
  ON public.status_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "status_settings_admin_delete"
  ON public.status_settings FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER status_settings_touch_updated_at
  BEFORE UPDATE ON public.status_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.status_settings (status_key, label, tone, sort_order) VALUES
  ('pending_check_close', 'לבדיקה לחסימה', 'amber', 10),
  ('pending_check_open',  'לבדיקה לפתיחה', 'teal', 20),
  ('open',                'פתוח', 'green', 30),
  ('to_open',             'לפתוח', 'lightgreen', 40),
  ('closed',              'חסום', 'red', 50),
  ('to_block',            'לחסום', 'lightred', 60),
  ('block_from_root',     'לחסום מהשורש', 'brightred', 70),
  ('problem',             'בעיה', 'orange', 80),
  ('open_only_bimot',     'לפתוח רק בימות', 'sky', 90),
  ('close_only_bimot',    'פתוח רק בימות', 'indigo', 100),
  ('open_in_simahedrin',  'לפתיחה בסימהדרין', 'cyan', 110),
  ('close_in_simahedrin', 'לחסימה בסימהדרין', 'violet', 120),
  ('send_to_yosela',      'לשלוח ליוסלה', 'fuchsia', 130)
ON CONFLICT (status_key) DO NOTHING;
