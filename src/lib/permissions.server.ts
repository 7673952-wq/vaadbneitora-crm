// Unified permission model — single source of truth for role checks.
//
// Role hierarchy (highest → lowest):
//   super_admin > admin > agent
//
// These are the only roles backed by the `app_role` enum in the database.
// A higher role implicitly satisfies a lower-role check (super_admin passes
// any admin check, admin passes any agent check). Membership is resolved
// against `public.user_roles`, the only place roles are stored.
//
// Server-only: imports the service-role client. Never import from client code.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AppError } from "@/lib/errors";

export const ROLE_HIERARCHY = ["super_admin", "admin", "agent"] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];

const HEBREW_LABEL: Record<Role, string> = {
  super_admin: "מנהל ראשי",
  admin: "מנהל",
  agent: "נציג",
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

/**
 * True when the user holds `required` or any role above it in the hierarchy.
 * This is the ONLY function any server fn should use to check authorization.
 */
export async function hasRole(userId: string, required: Role): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (!roles.length) return false;
  const need = rank(required);
  return roles.some((r) => rank(r) <= need);
}

/**
 * Throws AppError("forbidden") when the user lacks the required role.
 * This is the ONLY function any server fn should use to enforce authorization.
 */
export async function assertRole(userId: string, required: Role): Promise<void> {
  const ok = await hasRole(userId, required);
  if (!ok) {
    throw new AppError(`רק ${HEBREW_LABEL[required]} יכול לבצע פעולה זו`, { code: "forbidden" });
  }
}

// ---------- Back-compat shims (deprecated) ----------
// Existing callers use these names. New code should import `assertRole`
// or `hasRole` directly.
export const isAdminUserId = (userId: string) => hasRole(userId, "admin");
export const isSuperAdminUserId = (userId: string) => hasRole(userId, "super_admin");
export const assertAdminUserId = (userId: string) => assertRole(userId, "admin");
export const assertSuperAdminUserId = (userId: string) => assertRole(userId, "super_admin");
