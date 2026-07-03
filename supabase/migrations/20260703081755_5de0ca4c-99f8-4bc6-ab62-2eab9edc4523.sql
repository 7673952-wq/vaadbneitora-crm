UPDATE public.status_settings
SET is_mandatory = false,
    updated_at = now()
WHERE status_key = 'block_from_root';

NOTIFY pgrst, 'reload schema';