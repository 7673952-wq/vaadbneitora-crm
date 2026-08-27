CREATE OR REPLACE FUNCTION public.reports_summary(
  _status text DEFAULT NULL,
  _agent uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
WITH base AS (
  SELECT s.* FROM public.systems s
  WHERE (_status IS NULL OR s.status::text = _status)
    AND (_agent IS NULL OR s.assigned_agent_id = _agent)
),
by_status AS (
  SELECT jsonb_agg(jsonb_build_object('status', status, 'count', cnt) ORDER BY cnt DESC) j
  FROM (SELECT status::text AS status, count(*) cnt FROM base GROUP BY 1) t
),
by_agent AS (
  SELECT jsonb_agg(jsonb_build_object(
      'agent_id', agent_id,
      'agent_name', COALESCE(p.display_name, CASE WHEN agent_id IS NULL THEN 'לא משויך' ELSE 'לא ידוע' END),
      'total', total, 'open', o, 'closed', c, 'pending', pd
    ) ORDER BY total DESC) j
  FROM (
    SELECT assigned_agent_id AS agent_id,
           count(*) total,
           count(*) FILTER (WHERE status::text IN ('open','to_open')) o,
           count(*) FILTER (WHERE status::text IN ('closed','to_block','block_from_root')) c,
           count(*) FILTER (WHERE status::text IN ('pending_check_close','pending_check_open')) pd
    FROM base GROUP BY 1
  ) a LEFT JOIN public.profiles p ON p.id = a.agent_id
),
by_sub AS (
  SELECT jsonb_agg(jsonb_build_object(
      'parent_id', parent_id, 'system_code', system_code, 'name', name,
      'total_subs', total_subs, 'open', o, 'closed', c, 'pending', pd
    ) ORDER BY total_subs DESC) j
  FROM (
    SELECT par.id parent_id, par.system_code, par.name,
           count(k.id) total_subs,
           count(*) FILTER (WHERE k.status::text IN ('open','to_open')) o,
           count(*) FILTER (WHERE k.status::text IN ('closed','to_block','block_from_root')) c,
           count(*) FILTER (WHERE k.status::text IN ('pending_check_close','pending_check_open')) pd
    FROM base par
    JOIN public.systems k ON k.parent_system_id = par.id
    WHERE par.parent_system_id IS NULL
    GROUP BY 1,2,3
    HAVING count(k.id) > 0
  ) sub
),
period AS (
  SELECT
    (SELECT count(*) FROM public.systems s
      WHERE (_status IS NULL OR s.status::text = _status)
        AND (_agent IS NULL OR s.assigned_agent_id = _agent)
        AND (_from IS NULL OR s.created_at >= _from)
        AND (_to IS NULL OR s.created_at <= _to)) opened,
    (SELECT count(*) FROM public.systems s
      WHERE (_status IS NULL OR s.status::text = _status)
        AND (_agent IS NULL OR s.assigned_agent_id = _agent)
        AND (_from IS NULL OR s.updated_at >= _from)
        AND (_to IS NULL OR s.updated_at <= _to)) updated,
    (SELECT count(*) FROM public.system_activity_log l
      WHERE l.field = 'status' AND l.new_value = 'closed'
        AND (_from IS NULL OR l.created_at >= _from)
        AND (_to IS NULL OR l.created_at <= _to)) closed
)
SELECT jsonb_build_object(
  'byStatus', COALESCE((SELECT j FROM by_status), '[]'::jsonb),
  'byAgent', COALESCE((SELECT j FROM by_agent), '[]'::jsonb),
  'bySubsystem', COALESCE((SELECT j FROM by_sub), '[]'::jsonb),
  'period', (SELECT to_jsonb(period) FROM period)
);
$$;

GRANT EXECUTE ON FUNCTION public.reports_summary(text, uuid, timestamptz, timestamptz) TO authenticated, service_role;