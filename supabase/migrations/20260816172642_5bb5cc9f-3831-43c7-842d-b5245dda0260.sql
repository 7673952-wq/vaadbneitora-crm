CREATE OR REPLACE FUNCTION public.list_systems_page(
  _status_values text[] DEFAULT NULL,
  _secondary_values text[] DEFAULT NULL,
  _agent uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0,
  _q text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
WITH params AS (
  SELECT NULLIF(btrim(COALESCE(_q, '')), '') AS q,
         NULLIF(right(regexp_replace(COALESCE(_q, ''), '\D', '', 'g'), 9), '') AS qdigits
),
settings_count AS (
  SELECT count(*) AS n FROM public.status_settings
),
filtered AS (
  SELECT s.*,
    CASE
      WHEN (SELECT n FROM settings_count) = 0
        THEN (s.status::text = ANY (ARRAY['open','closed','blocked_from_root','sent_to_yosela','sent_to_committee','blocked_in_committee']))
      ELSE COALESCE((SELECT ss.is_handled FROM public.status_settings ss WHERE ss.status_key = s.status::text), false)
    END AS is_handled_row
  FROM public.systems s
  WHERE (_agent IS NULL OR s.assigned_agent_id = _agent)
    AND (_from IS NULL OR s.updated_at >= _from)
    AND (_to IS NULL OR s.updated_at <= _to)
    AND (
      _status_values IS NULL OR array_length(_status_values, 1) IS NULL
      OR btrim(s.status::text) = ANY (_status_values)
      OR btrim(COALESCE(s.secondary_status, '')) = ANY (_status_values)
    )
    AND (
      _secondary_values IS NULL OR array_length(_secondary_values, 1) IS NULL
      OR btrim(COALESCE(s.secondary_status, '')) = ANY (_secondary_values)
      OR btrim(s.status::text) = ANY (_secondary_values)
    )
    AND (
      (SELECT q FROM params) IS NULL
      OR concat_ws(' ',
           s.system_code, s.name, s.phone, s.caller_phone, s.email, s.source,
           s.secondary_status, s.status::text, s.notes,
           s.additional_caller_phones::text, s.additional_emails::text
         ) ILIKE '%' || (SELECT q FROM params) || '%'
      OR (
        (SELECT qdigits FROM params) IS NOT NULL
        AND length((SELECT qdigits FROM params)) >= 5
        AND regexp_replace(concat_ws(' ', s.system_code, s.phone, s.caller_phone, s.additional_caller_phones::text), '\D', '', 'g')
            LIKE '%' || (SELECT qdigits FROM params) || '%'
      )
    )
),
counted AS (SELECT count(*) AS total FROM filtered),
page AS (
  SELECT * FROM filtered
  ORDER BY is_handled_row ASC, updated_at DESC
  LIMIT GREATEST(_limit, 0) OFFSET GREATEST(_offset, 0)
)
SELECT jsonb_build_object(
  'total', (SELECT total FROM counted),
  'items', COALESCE((SELECT jsonb_agg(to_jsonb(page) - 'is_handled_row') FROM page), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.list_systems_page(text[], text[], uuid, timestamptz, timestamptz, int, int, text) TO authenticated;