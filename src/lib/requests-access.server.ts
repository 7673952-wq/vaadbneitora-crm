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
  permission: "requests_view" | "requests_decide" | "requests_manage" | "requests_delete",
  crmKey = "yemot",
) {
  const { hasPermission } = await import("@/lib/permissions.server");
  if (!(await hasPermission(userId, permission, crmKey))) throw new Error("אין הרשאה");
}

/**
 * Every CRM in which the user actually holds `permission`. Lists and counters
 * filter the QUERY by this, instead of reading everything with the service role
 * and trusting the screen to hide the rest.
 */
export async function crmKeysWithPermission(
  userId: string,
  permission: "requests_view" | "requests_decide" | "requests_manage" | "requests_delete",
): Promise<string[]> {
  const { listUserCrmKeys, hasPermission } = await import("@/lib/permissions.server");
  const keys = await listUserCrmKeys(userId);
  const allowed = await Promise.all(keys.map(async (k) => ((await hasPermission(userId, permission, k)) ? k : null)));
  return allowed.filter((k): k is string => Boolean(k));
}

/** Same, but throws when the user holds the permission in no CRM at all. */
export async function requireCrmKeysWithPermission(
  userId: string,
  permission: "requests_view" | "requests_decide" | "requests_manage" | "requests_delete",
): Promise<string[]> {
  const keys = await crmKeysWithPermission(userId, permission);
  if (!keys.length) throw new Error("אין הרשאה");
  return keys;
}

/**
 * Loads a request BY ID and authorizes against the CRM stored on the row.
 * The CRM never comes from the browser, so a permission held in one CRM can
 * never be used to touch another CRM's request.
 */
export async function loadAuthorizedRequest(
  supabaseAdmin: any,
  userSupabase: any,
  userId: string,
  id: string,
  permission: "requests_view" | "requests_decide" | "requests_manage" | "requests_delete",
  columns = "*",
  opts?: { allowDeleted?: boolean },
) {
  // `deleted_at` is always fetched (even when the caller asked for a narrower
  // column list) so the soft-delete gate below can never be bypassed by an
  // incomplete select.
  const select = columns === "*" || columns.includes("deleted_at") ? columns : `${columns}, deleted_at`;
  const { data: req, error } = await supabaseAdmin
    .from("system_requests").select(select).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!req) throw new Error("הבקשה לא נמצאה");
  // A soft-deleted request is refused for every action except the restore
  // flow itself, which passes `allowDeleted: true` explicitly.
  if ((req as any).deleted_at && !opts?.allowDeleted) throw new Error("הבקשה נמחקה");
  const crmKey = String((req as any).crm_key ?? "yemot");
  await assertCrmAccess(userSupabase, userId, crmKey);
  await assertRequestPermission(userId, permission, crmKey);
  return { req: req as any, crmKey };
}

/** Same contract for a rule row: the CRM comes from the stored rule. */
export async function loadAuthorizedRule(
  supabaseAdmin: any,
  userSupabase: any,
  userId: string,
  id: string,
) {
  const { data: rule, error } = await supabaseAdmin
    .from("system_request_rules").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!rule) throw new Error("הכלל לא נמצא");
  const crmKey = String((rule as any).crm_key ?? "yemot");
  await assertCrmAccess(userSupabase, userId, crmKey);
  await assertRequestPermission(userId, "requests_manage", crmKey);
  return { rule: rule as any, crmKey };
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
