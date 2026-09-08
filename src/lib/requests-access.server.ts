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
 *
 * The permission is ALWAYS resolved inside a single CRM. For a row-level
 * action the caller passes the CRM stored on the row itself (never a value
 * coming from the browser), so a permission granted in one CRM can never be
 * used to act on another one's requests.
 */
export async function assertRequestPermission(
  userId: string,
  permission: "requests_view" | "requests_decide" | "requests_manage",
  crmKey = "yemot",
) {
  const { hasPermission } = await import("@/lib/permissions.server");
  if (!(await hasPermission(userId, permission, crmKey))) throw new Error("אין הרשאה");
}

/**
 * Status values a rule or default may point at, for one CRM. Used to reject a
 * status that does not exist instead of storing an unusable rule.
 */
export async function assertKnownStatus(supabaseAdmin: any, status: string | null | undefined) {
  const value = String(status ?? "").trim();
  if (!value) return;
  const { data, error } = await supabaseAdmin
    .from("status_settings").select("status_key").eq("status_key", value).maybeSingle();
  if (error) throw new Error(`בדיקת הסטטוס נכשלה: ${error.message}`);
  if (!data) throw new Error(`הסטטוס "${value}" אינו קיים ברשימת הסטטוסים`);
}
