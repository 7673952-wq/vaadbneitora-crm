
ALTER TABLE public.systems ADD COLUMN IF NOT EXISTS secondary_status text;

INSERT INTO public.app_settings (key, value)
VALUES ('series_detection', '{"modes":[{"strip":2,"min":10},{"strip":3,"min":30}]}'::jsonb)
ON CONFLICT (key) DO NOTHING;
