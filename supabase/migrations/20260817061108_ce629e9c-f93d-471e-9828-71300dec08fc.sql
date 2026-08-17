CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP POLICY IF EXISTS "systems_update_yemot_writer" ON public.systems;

CREATE POLICY "systems_update_yemot_writer"
ON public.systems
FOR UPDATE
TO authenticated
USING (
  has_crm_access(auth.uid(), 'yemot'::text)
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
  has_crm_access(auth.uid(), 'yemot'::text)
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
);

CREATE INDEX IF NOT EXISTS systems_system_code_trgm ON public.systems USING gin (system_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS systems_name_trgm ON public.systems USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS systems_phone_trgm ON public.systems USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS systems_caller_phone_trgm ON public.systems USING gin (caller_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS systems_updated_at_idx ON public.systems (updated_at DESC);