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
  { key: "status_change", label: "שינוי סטטוס", description: "החלפת סטטוס למערכת" },
  { key: "agent_transfer", label: "העברת נציג", description: "שיוך מערכת לנציג אחר" },
  { key: "notes_write", label: "הוספת הערות", description: "כתיבת הערות בכרטיס מערכת" },
  { key: "files_manage", label: "ניהול קבצים", description: "העלאה ומחיקה של קבצים מצורפים" },
  { key: "import_export", label: "ייבוא / ייצוא", description: "ייבוא מאקסל וייצוא נתונים" },
  { key: "series_manage", label: "השלמת סדרות", description: "סריקה ויצירה מרוכזת של מספרים חסרים" },
  { key: "backup_manage", label: "גיבויים", description: "יצירה, הורדה, שליחה ושחזור לפי רמת ההרשאה" },
  { key: "audit_view", label: "יומן בקרה", description: "צפייה ביומן הפעילות והבקרה" },
  { key: "settings_manage", label: "הגדרות מערכת", description: "סטטוסים, שיוכים אוטומטיים והגדרות כלליות" },
  { key: "users_manage", label: "ניהול משתמשים", description: "יצירה, מחיקה ועדכון משתמשים" },
  { key: "permissions_manage", label: "ניהול הרשאות", description: "שינוי הרשאות לפי תפקיד ולפי משתמש" },
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
    files_manage: false,
    import_export: false,
    series_manage: false,
    backup_manage: false,
    audit_view: false,
    settings_manage: false,
    users_manage: false,
    permissions_manage: false,
  },
  agent: {
    systems_read: true,
    systems_write: true,
    systems_delete: false,
    status_change: true,
    agent_transfer: true,
    notes_write: true,
    files_manage: true,
    import_export: false,
    series_manage: false,
    backup_manage: false,
    audit_view: false,
    settings_manage: false,
    users_manage: false,
    permissions_manage: false,
  },
  admin: {
    systems_read: true,
    systems_write: true,
    systems_delete: false,
    status_change: true,
    agent_transfer: true,
    notes_write: true,
    files_manage: true,
    import_export: true,
    series_manage: true,
    backup_manage: true,
    audit_view: false,
    settings_manage: true,
    users_manage: false,
    permissions_manage: false,
  },
  super_admin: {
    systems_read: true,
    systems_write: true,
    systems_delete: true,
    status_change: true,
    agent_transfer: true,
    notes_write: true,
    files_manage: true,
    import_export: true,
    series_manage: true,
    backup_manage: true,
    audit_view: true,
    settings_manage: true,
    users_manage: true,
    permissions_manage: true,
  },
};

const HEBREW_LABEL: Record<Role, string> = {
  super_admin: "מנהל ראשי",
  admin: "מנהל",
  agent: "נציג",
  viewer: "צופה",
};

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

export async function hasPermission(userId: string, permission: PermissionKey): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (!roles.length) return false;

  const { data: userOverride, error: overrideError } = await supabaseAdmin
    .from("user_permissions")
    .select("allowed")
    .eq("user_id", userId)
    .eq("permission", permission)
    .maybeSingle();
  if (overrideError && overrideError.code !== "PGRST116") {
    throw new AppError(overrideError.message, { code: "internal", cause: overrideError });
  }
  if (typeof (userOverride as any)?.allowed === "boolean") return Boolean((userOverride as any).allowed);

  const { data: roleRows, error: roleError } = await supabaseAdmin
    .from("role_permissions")
    .select("role, allowed")
    .eq("permission", permission)
    .in("role", roles as any);
  if (roleError) throw new AppError(roleError.message, { code: "internal", cause: roleError });

  if ((roleRows ?? []).some((r: any) => r.allowed === true)) return true;
  if ((roleRows ?? []).some((r: any) => r.allowed === false)) return false;

  // Fallback for fresh/local databases before the permissions seed exists.
  return roles.some((role) => DEFAULT_ROLE_PERMISSIONS[role]?.[permission] === true);
}

export async function getUserPermissionMap(userId: string): Promise<Record<PermissionKey, boolean>> {
  const pairs = await Promise.all(PERMISSION_DEFINITIONS.map(async (p) => [p.key, await hasPermission(userId, p.key)] as const));
  return Object.fromEntries(pairs) as Record<PermissionKey, boolean>;
}

export async function assertPermission(userId: string, permission: PermissionKey): Promise<void> {
  const ok = await hasPermission(userId, permission);
  if (!ok) {
    throw new AppError(`אין הרשאה: ${PERMISSION_LABEL[permission]}`, { code: "forbidden" });
  }
}

export async function assertAnyPermission(userId: string, permissions: PermissionKey[]): Promise<void> {
  for (const permission of permissions) {
    if (await hasPermission(userId, permission)) return;
  }
  throw new AppError("אין הרשאה לביצוע פעולה זו", { code: "forbidden" });
}

/**
 * Throws when the caller is read-only (viewer or no role). Use at the top of
 * EVERY write server fn so viewers can never mutate data even if RLS permits it.
 */
export async function assertCanWrite(userId: string): Promise<void> {
  const ok = await hasPermission(userId, "systems_write");
  if (!ok) {
    throw new AppError("אין הרשאת עריכה למערכות", { code: "forbidden" });
  }
}
