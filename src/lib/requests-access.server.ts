// Access helpers for the request-automation server functions.
// Kept out of *.functions.ts so those files stay thin wrappers.

/** Throws unless the caller has access to the CRM the request belongs to. */
export async function assertCrmAccess(supabase: any, userId: string, crmKey: string | null | undefined) {
  const { data: ok } = await supabase.rpc("has_crm_access", {
    _user_id: userId,
    _crm_key: crmKey ?? "yemot",
  });
  if (ok !== true) throw new Error("אין הרשאה לבקשה זו");
}

/**
 * Server-side permission gate for the requests area.
 * `hasPermission` already applies the static prerequisites, so asking for
 * `requests_decide` implicitly requires `requests_view` as well — a user can
 * never act on a request they are not allowed to see.
 */
export async function assertRequestPermission(
  userId: string,
  permission: "requests_view" | "requests_decide" | "requests_manage",
) {
  const { hasPermission } = await import("@/lib/permissions.server");
  if (!(await hasPermission(userId, permission))) throw new Error("אין הרשאה");
}
