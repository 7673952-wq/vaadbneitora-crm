// Unified permission model — single source of truth for role checks.
//
// Role hierarchy (highest → lowest):
//   super_admin > admin > agent > viewer
//
// `viewer` is read-only — CANNOT write anything. Membership is resolved
// against `public.user_roles`. Server-only file.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AppError } from "@/lib/errors";

export const ROLE_HIERARCHY = ["super_admin", "admin", "agent", "viewer"] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];

export const PERMISSION_DEFINITIONS = [
  { key: "systems_read", label: "צפייה במערכות", description: "כניסה לדשבורד וצפייה בכרטיסי מערכת" },
  { key: "systems_write", label: "עריכת מערכות", description: "יצירה ועריכה כללית של מערכות" },
  { key: "systems_delete", label: "מחיקת מערכות", description: "מחיקת מערכת ראשית או תת־מערכת" },
  { key: "system_name_edit", label: "עריכת שם מערכת", description: "שינוי שם של מערכת קיימת" },
  { key: "system_code_edit", label: "עריכת מספר מערכת", description: "שינוי מזהה/מספר לחיוג של מערכת קיימת" },
  { key: "status_change", label: "שינוי סטטוס", description: "החלפת סטטוס למערכת" },
  { key: "agent_transfer", label: "העברת נציג", description: "שיוך מערכת לנציג אחר" },
  { key: "notes_write", label: "הוספת הערות", description: "כתיבת הערות בכרטיס מערכת" },
  { key: "emails_send", label: "שליחת מיילים", description: "שליחת מייל חדש או תגובה בתוך שרשור מתוך כרטיס מערכת" },
  { key: "files_manage", label: "ניהול קבצים", description: "העלאה ומחיקה של קבצים מצורפים" },
  { key: "import_export", label: "ייבוא / ייצוא", description: "ייבוא מאקסל וייצוא נתונים" },
  { key: "series_manage", label: "השלמת סדרות", description: "סריקה ויצירה מרוכזת של מספרים חסרים" },
  { key: "backup_manage", label: "גיבויים", description: "יצירה, הורדה, שליחה ושחזור לפי רמת ההרשאה" },
  { key: "audit_view", label: "יומן בקרה", description: "צפייה ביומן הפעילות והבקרה" },
  { key: "settings_manage", label: "הגדרות מערכת", description: "סטטוסים, שיוכים אוטומטיים והגדרות כלליות" },
  { key: "users_manage", label: "ניהול משתמשים", description: "יצירה, מחיקה ועדכון משתמשים" },
  { key: "permissions_manage", label: "ניהול הרשאות", description: "שינוי הרשאות לפי תפקיד ולפי משתמש" },
  { key: "mailbox_view", label: "צפייה בתיבת הדואר", description: "כניסה ללשונית המיילים וצפייה בשרשורי הדואר" },
  { key: "history_edit", label: "עריכת הערות ופעילות", description: "עריכה ומחיקה של הערות ושורות ביומן הפעילות של כל המשתמשים" },
] as const;

export type PermissionKey = (typeof PERMISSION_DEFINITIONS)[number]["key"];

const PERMISSION_LABEL = Object.fromEntries(
  PERMISSION_DEFINITIONS.map((p) => [p.key, p.label]),
) as Record<PermissionKey, string>;

const DEFAULT_ROLE_PERMISSIONS: Record<Role, Record<PermissionKey, boolean>> = {
  viewer: {
    systems_read: true,
    systems_write: false,
    systems_delete: false,
    status_change: false,
    agent_transfer: false,
    notes_write: false,
    emails_send: false,
    files_manage: false,
    import_export: false,
    series_manage: false,
    backup_manage: false,
    audit_view: false,
    settings_manage: false,
    users_manage: false,
    permissions_manage: false,
    system_name_edit: false,
    system_code_edit: false,
    history_edit: false,
    mailbox_view: false,
  },
  agent: {
    systems_read: true,
    systems_write: true,
    systems_delete: false,
    status_change: true,
    agent_transfer: true,
    notes_write: true,
    emails_send: true,
    files_manage: true,
    import_export: false,
    series_manage: false,
    backup_manage: false,
    audit_view: false,
    settings_manage: false,
    users_manage: false,
    permissions_manage: false,
    system_name_edit: false,
    system_code_edit: false,
    history_edit: false,
    mailbox_view: true,
  },
  admin: {
    systems_read: true,
    systems_write: true,
    systems_delete: false,
    status_change: true,
    agent_transfer: true,
    notes_write: true,
    emails_send: true,
    files_manage: true,
    import_export: true,
    series_manage: true,
    backup_manage: true,
    audit_view: false,
    settings_manage: true,
    users_manage: false,
    permissions_manage: false,
    system_name_edit: true,
    system_code_edit: false,
    history_edit: true,
    mailbox_view: true,
  },
  super_admin: {
    systems_read: true,
    systems_write: true,
    systems_delete: true,
    status_change: true,
    agent_transfer: true,
    notes_write: true,
    emails_send: true,
    files_manage: true,
    import_export: true,
    series_manage: true,
    backup_manage: true,
    audit_view: true,
    settings_manage: true,
    users_manage: true,
    permissions_manage: true,
    system_name_edit: true,
    system_code_edit: true,
    history_edit: true,
    mailbox_view: true,
  },
};

const HEBREW_LABEL: Record<Role, string> = {
  super_admin: "מנהל ראשי",
  admin: "מנהל",
  agent: "נציג",
  viewer: "צופה",
};

const PERMISSION_SETTINGS_KEY = "permission_settings";

type StoredPermissionSettings = {
  rolePermissions: Array<{ role: string; permission: string; allowed: boolean }>;
  userPermissions: Array<{ user_id: string; permission: string; allowed: boolean }>;
};

function isSchemaCacheMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null | undefined;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`;
  return e?.code === "PGRST205"
    || text.includes("schema cache")
    || text.includes("Could not find the table")
    || text.includes("relation") && text.includes("does not exist");
}

function defaultPermissionForRoles(roles: Role[], permission: PermissionKey): boolean {
  return roles.some((role) => DEFAULT_ROLE_PERMISSIONS[role]?.[permission] === true);
}

function defaultRolePermissionRows() {
  return ROLE_HIERARCHY.flatMap((role) => PERMISSION_DEFINITIONS.map((p) => ({
    role,
    permission: p.key,
    allowed: DEFAULT_ROLE_PERMISSIONS[role][p.key],
  })));
}

function normalizePermissionSettings(value: unknown): StoredPermissionSettings {
  const v = (value ?? {}) as Partial<StoredPermissionSettings>;
  const rolePermissions = Array.isArray(v.rolePermissions) && v.rolePermissions.length
    ? v.rolePermissions
        .filter((r: any) => ROLE_HIERARCHY.includes(r?.role) && isPermissionKey(r?.permission) && typeof r?.allowed === "boolean")
        .map((r: any) => ({ role: r.role, permission: r.permission, allowed: r.allowed }))
    : defaultRolePermissionRows();
  const userPermissions = Array.isArray(v.userPermissions)
    ? v.userPermissions
        .filter((r: any) => typeof r?.user_id === "string" && isPermissionKey(r?.permission) && typeof r?.allowed === "boolean")
        .map((r: any) => ({ user_id: r.user_id, permission: r.permission, allowed: r.allowed }))
    : [];
  return { rolePermissions, userPermissions };
}

async function getStoredPermissionSettings(): Promise<StoredPermissionSettings> {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", PERMISSION_SETTINGS_KEY)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    return { rolePermissions: defaultRolePermissionRows(), userPermissions: [] };
  }
  return normalizePermissionSettings((data as any)?.value);
}

function rank(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role as Role);
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

export async function getUserRoles(userId: string): Promise<Role[]> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new AppError(error.message, { code: "internal", cause: error });
  return (data ?? []).map((r: any) => r.role as Role).filter((r) => ROLE_HIERARCHY.includes(r));
}

export async function hasRole(userId: string, required: Role): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (!roles.length) return false;
  const need = rank(required);
  return roles.some((r) => rank(r) <= need);
}

export async function assertRole(userId: string, required: Role): Promise<void> {
  const ok = await hasRole(userId, required);
  if (!ok) {
    throw new AppError(`רק ${HEBREW_LABEL[required]} יכול לבצע פעולה זו`, { code: "forbidden" });
  }
}

export function isPermissionKey(permission: string): permission is PermissionKey {
  return PERMISSION_DEFINITIONS.some((p) => p.key === permission);
}

export async function getCrmRoles(userId: string, crmKey: string): Promise<Role[]> {
  const globalRoles = await getUserRoles(userId);
  if (globalRoles.includes("super_admin")) return ["super_admin"];
  const { data, error } = await supabaseAdmin
    .from("crm_user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("crm_key", crmKey);
  if (error) throw new AppError(error.message, { code: "internal", cause: error });
  return (data ?? []).map((r: any) => r.role as Role).filter((r) => ROLE_HIERARCHY.includes(r));
}

export async function hasCrmAccess(userId: string, crmKey: string): Promise<boolean> {
  return (await getCrmRoles(userId, crmKey)).length > 0;
}

export async function assertCrmAccess(userId: string, crmKey: string): Promise<void> {
  if (!(await hasCrmAccess(userId, crmKey))) {
    throw new AppError("אין לך גישה ל-CRM זה", { code: "forbidden" });
  }
}

export async function hasPermission(userId: string, permission: PermissionKey, crmKey = "yemot"): Promise<boolean> {
  const roles = await getCrmRoles(userId, crmKey);
  if (!roles.length) return false;
  // A super admin must always retain full management access. Dynamic
  // permission rows can narrow admin/agent/viewer roles, but cannot lock the
  // only top-level administrator out of statuses, permissions, or users.
  if (roles.includes("super_admin")) return true;

  const { data: userOverride, error: overrideError } = await supabaseAdmin
    .from("user_permissions")
    .select("allowed")
    .eq("user_id", userId)
    .eq("crm_key", crmKey)
    .eq("permission", permission)
    .maybeSingle();
  if (overrideError && overrideError.code !== "PGRST116") {
    if (isSchemaCacheMissing(overrideError)) return defaultPermissionForRoles(roles, permission);
    throw new AppError(overrideError.message, { code: "internal", cause: overrideError });
  }
  if (typeof (userOverride as any)?.allowed === "boolean") return Boolean((userOverride as any).allowed);

  const { data: roleRows, error: roleError } = await supabaseAdmin
    .from("role_permissions")
    .select("role, allowed")
    .eq("crm_key", crmKey)
    .eq("permission", permission)
    .in("role", roles as any);
  if (roleError) {
    if (isSchemaCacheMissing(roleError)) return defaultPermissionForRoles(roles, permission);
    throw new AppError(roleError.message, { code: "internal", cause: roleError });
  }

  if ((roleRows ?? []).some((r: any) => r.allowed === true)) return true;
  if ((roleRows ?? []).some((r: any) => r.allowed === false)) return false;

  // Fallback for fresh/local databases before the permissions seed exists.
  return defaultPermissionForRoles(roles, permission);
}

export async function getUserPermissionMap(userId: string, crmKey = "yemot"): Promise<Record<PermissionKey, boolean>> {
  const pairs = await Promise.all(PERMISSION_DEFINITIONS.map(async (p) => [p.key, await hasPermission(userId, p.key, crmKey)] as const));
  return Object.fromEntries(pairs) as Record<PermissionKey, boolean>;
}

export async function assertPermission(userId: string, permission: PermissionKey, crmKey = "yemot"): Promise<void> {
  const ok = await hasPermission(userId, permission, crmKey);
  if (!ok) {
    throw new AppError(`אין הרשאה: ${PERMISSION_LABEL[permission]}`, { code: "forbidden" });
  }
}

/**
 * The "כללי" (General) admin tab holds settings that apply to EVERY CRM
 * (auto-snooze, stale warning, backups, mail relay, notification bell).
 * Access to them must therefore be granted by the permission in ANY CRM the
 * user belongs to — not only in the original "yemot" CRM.
 */
export async function listUserCrmKeys(userId: string): Promise<string[]> {
  const globalRoles = await getUserRoles(userId);
  if (globalRoles.includes("super_admin")) {
    const { data } = await supabaseAdmin.from("crms").select("key");
    return (data ?? []).map((c: any) => c.key as string);
  }
  const { data, error } = await supabaseAdmin
    .from("crm_user_roles").select("crm_key").eq("user_id", userId);
  if (error) throw new AppError(error.message, { code: "internal", cause: error });
  return Array.from(new Set((data ?? []).map((r: any) => r.crm_key as string)));
}

/** True when the permission is granted in at least one of the user's CRMs. */
export async function hasPermissionInAnyCrm(userId: string, permission: PermissionKey): Promise<boolean> {
  const keys = await listUserCrmKeys(userId);
  if (!keys.length) return false;
  const results = await Promise.all(keys.map((k) => hasPermission(userId, permission, k)));
  return results.some(Boolean);
}

export async function assertPermissionInAnyCrm(userId: string, permission: PermissionKey): Promise<void> {
  if (!(await hasPermissionInAnyCrm(userId, permission))) {
    throw new AppError(`אין הרשאה: ${PERMISSION_LABEL[permission]}`, { code: "forbidden" });
  }
}

/** Union of the permission maps across every CRM the user belongs to. */
export async function getGlobalPermissionMap(userId: string): Promise<Record<PermissionKey, boolean>> {
  const keys = await listUserCrmKeys(userId);
  const maps = await Promise.all(keys.map((k) => getUserPermissionMap(userId, k)));
  const out = Object.fromEntries(PERMISSION_DEFINITIONS.map((p) => [p.key, false])) as Record<PermissionKey, boolean>;
  for (const m of maps) for (const p of PERMISSION_DEFINITIONS) if (m[p.key]) out[p.key] = true;
  return out;
}

export async function assertAnyPermission(userId: string, permissions: PermissionKey[]): Promise<void> {
  // Shared/global admin areas: the permission may come from ANY CRM.
  for (const permission of permissions) {
    if (await hasPermissionInAnyCrm(userId, permission)) return;
  }
  throw new AppError("אין הרשאה לביצוע פעולה זו", { code: "forbidden" });
}

/**
 * Throws when the caller is read-only (viewer or no role). Use at the top of
 * EVERY write server fn so viewers can never mutate data even if RLS permits it.
 */
export async function assertCanWrite(userId: string, crmKey = "yemot"): Promise<void> {
  const ok = await hasPermission(userId, "systems_write", crmKey);
  if (!ok) {
    throw new AppError("אין הרשאת עריכה למערכות", { code: "forbidden" });
  }
}

// ============= Mail scope (global, not tied to a single CRM) =============

/**
 * The mailbox is a shared, cross-CRM area. Its permissions therefore live in
 * their own pseudo-CRM scope ("_mail") and are resolved from the user's roles
 * in ANY CRM — so mail access is never dictated by the "ימות המשיח" CRM.
 */
export const MAIL_SCOPE = "_mail";

/** Mail-related permissions surfaced in ניהול → מיילים → הרשאות. */
export const MAIL_PERMISSION_KEYS = ["mailbox_view", "emails_send", "settings_manage"] as const;

async function getEffectiveRoles(userId: string): Promise<Role[]> {
  const globalRoles = await getUserRoles(userId);
  if (globalRoles.includes("super_admin")) return ["super_admin"];
  const { data } = await supabaseAdmin
    .from("crm_user_roles").select("role").eq("user_id", userId);
  const all = [...globalRoles, ...((data ?? []).map((r: any) => r.role as Role))]
    .filter((r) => ROLE_HIERARCHY.includes(r));
  return Array.from(new Set(all));
}

export async function hasMailPermission(userId: string, permission: PermissionKey): Promise<boolean> {
  const roles = await getEffectiveRoles(userId);
  if (!roles.length) return false;
  if (roles.includes("super_admin")) return true;

  const { data: userOverride } = await supabaseAdmin
    .from("user_permissions")
    .select("allowed")
    .eq("user_id", userId)
    .eq("crm_key", MAIL_SCOPE)
    .eq("permission", permission)
    .maybeSingle();
  if (typeof (userOverride as any)?.allowed === "boolean") return Boolean((userOverride as any).allowed);

  const { data: roleRows } = await supabaseAdmin
    .from("role_permissions")
    .select("role, allowed")
    .eq("crm_key", MAIL_SCOPE)
    .eq("permission", permission)
    .in("role", roles as any);
  if ((roleRows ?? []).some((r: any) => r.allowed === true)) return true;
  if ((roleRows ?? []).some((r: any) => r.allowed === false)) return false;
  return defaultPermissionForRoles(roles, permission);
}

export async function assertMailPermission(userId: string, permission: PermissionKey): Promise<void> {
  if (!(await hasMailPermission(userId, permission))) {
    throw new AppError(`אין הרשאה: ${PERMISSION_LABEL[permission]}`, { code: "forbidden" });
  }
}

export async function getMailPermissionMap(userId: string): Promise<Record<string, boolean>> {
  const pairs = await Promise.all(
    MAIL_PERMISSION_KEYS.map(async (k) => [k, await hasMailPermission(userId, k as PermissionKey)] as const),
  );
  return Object.fromEntries(pairs);
}
