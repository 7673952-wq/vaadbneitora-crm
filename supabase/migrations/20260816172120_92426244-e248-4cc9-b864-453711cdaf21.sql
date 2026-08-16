-- 1. Tighten UPDATE RLS on systems: agents may only update systems assigned to
--    them (or unassigned / where they are a reminder recipient).
DROP POLICY IF EXISTS systems_update_yemot_writer ON public.systems;

CREATE POLICY systems_update_yemot_writer ON public.systems
FOR UPDATE
TO authenticated
USING (
  public.has_crm_access(auth.uid(), 'yemot')
  AND (
    private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_user_roles r
      WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot'
        AND r.role = ANY (ARRAY['admin'::app_role, 'super_admin'::app_role])
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.crm_user_roles r
        WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role = 'agent'::app_role
      )
      AND (
        assigned_agent_id = auth.uid()
        OR assigned_agent_id IS NULL
        OR auth.uid() = ANY (COALESCE(reminder_agent_ids, ARRAY[]::uuid[]))
      )
    )
  )
)
WITH CHECK (
  public.has_crm_access(auth.uid(), 'yemot')
  AND (
    private.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_user_roles r
      WHERE r.user_id = auth.uid() AND r.crm_key = 'yemot' AND r.role <> 'viewer'::app_role
    )
  )
);

-- 2. Fast server-side listing: waiting-before-handled ordering + pagination
--    done in SQL instead of pulling the whole table into the app server.
CREATE OR REPLACE FUNCTION public.list_systems_page(
  _status_values text[] DEFAULT NULL,
  _secondary_values text[] DEFAULT NULL,
  _agent uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
WITH settings_count AS (
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

GRANT EXECUTE ON FUNCTION public.list_systems_page(text[], text[], uuid, timestamptz, timestamptz, int, int) TO authenticated;

-- 3. Status counts computed in the database (GROUP BY) instead of streaming
--    every row to the app server.
CREATE OR REPLACE FUNCTION public.systems_status_counts(
  _agent uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
)
RETURNS TABLE (status text, secondary_status text, cnt bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT s.status::text, s.secondary_status, count(*)::bigint
  FROM public.systems s
  WHERE (_agent IS NULL OR s.assigned_agent_id = _agent)
    AND (_from IS NULL OR s.updated_at >= _from)
    AND (_to IS NULL OR s.updated_at <= _to)
  GROUP BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION public.systems_status_counts(uuid, timestamptz, timestamptz) TO authenticated;

-- 4. Retention for activity logs — keeps the live tables from growing forever.
CREATE OR REPLACE FUNCTION public.purge_old_activity_logs(_days int DEFAULT 365)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cutoff timestamptz := now() - make_interval(days => GREATEST(_days, 30));
  _sys int := 0;
  _crm int := 0;
BEGIN
  DELETE FROM public.system_activity_log WHERE created_at < _cutoff;
  GET DIAGNOSTICS _sys = ROW_COUNT;
  DELETE FROM public.crm_record_activity WHERE created_at < _cutoff;
  GET DIAGNOSTICS _crm = ROW_COUNT;
  RETURN jsonb_build_object('cutoff', _cutoff, 'system_activity_log', _sys, 'crm_record_activity', _crm);
END $$;

REVOKE ALL ON FUNCTION public.purge_old_activity_logs(int) FROM public;
GRANT EXECUTE ON FUNCTION public.purge_old_activity_logs(int) TO service_role;

-- 5. Supporting indexes for the new ordering / lookups.
CREATE INDEX IF NOT EXISTS systems_updated_at_idx ON public.systems (updated_at DESC);
CREATE INDEX IF NOT EXISTS systems_status_idx ON public.systems (status);
CREATE INDEX IF NOT EXISTS systems_secondary_status_idx ON public.systems (secondary_status);
CREATE INDEX IF NOT EXISTS systems_assigned_agent_idx ON public.systems (assigned_agent_id);