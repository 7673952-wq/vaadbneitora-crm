DROP POLICY IF EXISTS "crms_select_authenticated" ON public.crms;
CREATE POLICY "crms_select_scoped" ON public.crms
FOR SELECT TO authenticated
USING (
  public.has_crm_access(auth.uid(), key)
  OR private.has_role(auth.uid(), 'admin'::app_role)
  OR private.has_role(auth.uid(), 'super_admin'::app_role)
);

DROP POLICY IF EXISTS "role_permissions_read_authenticated" ON public.role_permissions;
CREATE POLICY "role_permissions_read_scoped" ON public.role_permissions
FOR SELECT TO authenticated
USING (
  public.has_crm_access(auth.uid(), crm_key)
  OR private.has_role(auth.uid(), 'admin'::app_role)
  OR private.has_role(auth.uid(), 'super_admin'::app_role)
);

DROP POLICY IF EXISTS "notif_role_defaults_read" ON public.notification_role_defaults;
CREATE POLICY "notif_role_defaults_read_scoped" ON public.notification_role_defaults
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = notification_role_defaults.role
  )
  OR EXISTS (
    SELECT 1 FROM public.crm_user_roles cur
    WHERE cur.user_id = auth.uid() AND cur.role = notification_role_defaults.role
  )
  OR private.has_role(auth.uid(), 'admin'::app_role)
  OR private.has_role(auth.uid(), 'super_admin'::app_role)
);