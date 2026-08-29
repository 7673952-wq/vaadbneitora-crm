// Unified permission model — single source of truth for role checks.
//
// Role hierarchy (highest → lowest):
//   super_admin > admin > agent > viewer
//
// `viewer` is read-only — CANNOT write anything. Membership is resolved
// against `public.user_roles`. Server-only file.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AppError } from "@/lib/errors";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  PERMISSION_LABEL,
  PERMISSION_PREREQUISITES,
  ROLE_HIERARCHY,
  ROLE_LABEL,
  defaultPermissionForRoles,
  defaultRolePermissionRows,
  isPermissionKey,
  type PermissionKey,
  type Role,
} from "@/lib/permissions.config";

// The static model lives in `permissions.config.ts` (client-safe). This file
// only adds the I/O: role lookups, dynamic overrides and assertions.
export {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  PERMISSION_LABEL,
  PERMISSION_PREREQUISITES,
  ROLE_HIERARCHY,
  defaultRolePermissionRows,
  isPermissionKey,
} from "@/lib/permissions.config";
export type { PermissionKey, Role } from "@/lib/permissions.config";

const HEBREW_LABEL = ROLE_LABEL;

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

/**
 * Audit trail for refused access. Every failed permission / CRM-access check
 * (and every rejected webhook) is written to `system_activity_log` with
 * `action = 'denied'`, so the audit screen shows attempts, not only successes.
 * Best-effort: an audit failure must never mask the original refusal.
 */
export async function logDeniedAttempt(userId: string | null, what: string, detail?: string): Promise<void> {
  try {
    await supabaseAdmin.from("system_activity_log").insert({
      system_id: null,
      actor_id: userId,
      action: "denied",
      field: what,
      new_value: detail ?? null,
    } as any);
  } catch {
    /* audit is best-effort */
  }
}

export async function assertCrmAccess(userId: string, crmKey: string): Promise<void> {
  if (!(await hasCrmAccess(userId, crmKey))) {
    void logDeniedAttempt(userId, "crm_access", crmKey);
    throw new AppError("אין לך גישה ל-CRM זה", { code: "forbidden" });
  }
}

/**
 * Raw resolution of a single permission (overrides → role rows → defaults),
 * WITHOUT prerequisite enforcement. Use `hasPermission` everywhere except
 * inside the prerequisite check itself.
 */
async function resolveRawPermission(userId: string, permission: PermissionKey, crmKey = "yemot"): Promise<boolean> {
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

/**
 * Effective permission check. A permission with prerequisites (e.g.
 * `requests_decide` requires `requests_view`) is only granted when every
 * prerequisite is granted too — enforced server-side, so a hand-crafted RPC
 * call cannot act on requests without the right to see them.
 */
export async function hasPermission(userId: string, permission: PermissionKey, crmKey = "yemot"): Promise<boolean> {
  if (!(await resolveRawPermission(userId, permission, crmKey))) return false;
  for (const prereq of PERMISSION_PREREQUISITES[permission] ?? []) {
    if (!(await resolveRawPermission(userId, prereq, crmKey))) return false;
  }
  return true;
}

/** Applies the prerequisite rule to a whole resolved permission map. */
function applyPrerequisites(map: Record<PermissionKey, boolean>): Record<PermissionKey, boolean> {
  for (const [key, prereqs] of Object.entries(PERMISSION_PREREQUISITES) as Array<[PermissionKey, PermissionKey[]]>) {
    if (map[key] && prereqs.some((p) => map[p] === false)) map[key] = false;
  }
  return map;
}


export async function getUserPermissionMap(userId: string, crmKey = "yemot"): Promise<Record<PermissionKey, boolean>> {
  const roles = await getCrmRoles(userId, crmKey);
  const out = Object.fromEntries(
    PERMISSION_DEFINITIONS.map((p) => [p.key, defaultPermissionForRoles(roles, p.key)]),
  ) as Record<PermissionKey, boolean>;
  if (!roles.length || roles.includes("super_admin")) return out;

  const [{ data: roleRows, error: roleError }, { data: userRows, error: userError }] = await Promise.all([
    supabaseAdmin.from("role_permissions").select("permission, allowed").eq("crm_key", crmKey).in("role", roles as any),
    supabaseAdmin.from("user_permissions").select("permission, allowed").eq("crm_key", crmKey).eq("user_id", userId),
  ]);
  if (roleError && !isSchemaCacheMissing(roleError)) throw new AppError(roleError.message, { code: "internal", cause: roleError });
  if (userError && !isSchemaCacheMissing(userError)) throw new AppError(userError.message, { code: "internal", cause: userError });

  for (const row of roleRows ?? []) {
    const key = (row as any).permission as PermissionKey;
    if (isPermissionKey(key) && (row as any).allowed === true) out[key] = true;
  }
  for (const row of roleRows ?? []) {
    const key = (row as any).permission as PermissionKey;
    if (isPermissionKey(key) && (row as any).allowed === false && !(roleRows ?? []).some((r: any) => r.permission === key && r.allowed === true)) out[key] = false;
  }
  for (const row of userRows ?? []) {
    const key = (row as any).permission as PermissionKey;
    if (isPermissionKey(key) && typeof (row as any).allowed === "boolean") out[key] = Boolean((row as any).allowed);
  }
  return applyPrerequisites(out);
}

export async function assertPermission(userId: string, permission: PermissionKey, crmKey = "yemot"): Promise<void> {
  const ok = await hasPermission(userId, permission, crmKey);
  if (!ok) {
    void logDeniedAttempt(userId, permission, crmKey);
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
    void logDeniedAttempt(userId, permission, "any_crm");
    throw new AppError(`אין הרשאה: ${PERMISSION_LABEL[permission]}`, { code: "forbidden" });
  }
}

/** Union of the permission maps across every CRM the user belongs to. */
export async function getGlobalPermissionMap(userId: string): Promise<Record<PermissionKey, boolean>> {
  const keys = await listUserCrmKeys(userId);
  const maps = await Promise.all(keys.map((k) => getUserPermissionMap(userId, k)));
  const out = Object.fromEntries(PERMISSION_DEFINITIONS.map((p) => [p.key, false])) as Record<PermissionKey, boolean>;
  for (const m of maps) for (const p of PERMISSION_DEFINITIONS) if (m[p.key]) out[p.key] = true;
  return applyPrerequisites(out);
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
    void logDeniedAttempt(userId, "systems_write", crmKey);
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
export const MAIL_PERMISSION_KEYS = ["mailbox_view", "emails_send", "emails_edit", "emails_delete", "settings_manage"] as const;

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
    void logDeniedAttempt(userId, permission, "_mail");
    throw new AppError(`אין הרשאה: ${PERMISSION_LABEL[permission]}`, { code: "forbidden" });
  }
}

export async function getMailPermissionMap(userId: string): Promise<Record<string, boolean>> {
  const roles = await getEffectiveRoles(userId);
  const out = Object.fromEntries(
    MAIL_PERMISSION_KEYS.map((key) => [key, defaultPermissionForRoles(roles, key)]),
  ) as Record<string, boolean>;
  if (!roles.length || roles.includes("super_admin")) return out;

  const [{ data: roleRows }, { data: userRows }] = await Promise.all([
    supabaseAdmin.from("role_permissions").select("permission, allowed").eq("crm_key", MAIL_SCOPE).in("role", roles as any),
    supabaseAdmin.from("user_permissions").select("permission, allowed").eq("crm_key", MAIL_SCOPE).eq("user_id", userId),
  ]);
  for (const key of MAIL_PERMISSION_KEYS) {
    const matching = (roleRows ?? []).filter((row: any) => row.permission === key);
    if (matching.some((row: any) => row.allowed === true)) out[key] = true;
    else if (matching.some((row: any) => row.allowed === false)) out[key] = false;
    const override = (userRows ?? []).find((row: any) => row.permission === key);
    if (typeof (override as any)?.allowed === "boolean") out[key] = Boolean((override as any).allowed);
  }
  return out;
}
