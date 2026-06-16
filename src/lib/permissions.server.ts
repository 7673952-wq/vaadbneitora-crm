// Unified permission model — single source of truth for role checks.
//
// Role hierarchy (highest → lowest):
//   super_admin > admin > manager > team_lead > agent > viewer
//
// A role implicitly grants every role below it (e.g. an admin satisfies a
// `team_lead` check). Membership is resolved against `public.user_roles`,
// which is the only place roles are stored.
//
// Server-only: imports the service-role client. Never import from client code.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AppError } from "@/lib/errors";

export const ROLE_HIERARCHY = [
  "super_admin",
  "admin",
  "manager",
  "team_lead",
  "agent",
  "viewer",
] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];

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
 */
export async function hasRole(userId: string, required: Role): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (!roles.length) return false;
  const need = rank(required);
  return roles.some((r) => rank(r) <= need);
}

export async function assertRole(userId: string, required: Role): Promise<void> {
  const ok = await hasRole(userId, required);
  if (!ok) {
    const hebrew: Record<Role, string> = {
      super_admin: "מנהל ראשי",
      admin: "מנהל",
      manager: "מנהל צוות",
      team_lead: "ראש צוות",
      agent: "נציג",
      viewer: "צופה",
    };
    throw new AppError(`רק ${hebrew[required]} יכול לבצע פעולה זו`, { code: "forbidden" });
  }
}

// ---------- Back-compat shims ----------
// The codebase previously imported these from `@/lib/admin-role.server`.
// Keeping the same names so server-fn handlers can switch imports with a
// one-line change. Prefer `hasRole`/`assertRole` for new code.

export const isAdminUserId = (userId: string) => hasRole(userId, "admin");
export const isSuperAdminUserId = (userId: string) => hasRole(userId, "super_admin");
export const assertAdminUserId = (userId: string) => assertRole(userId, "admin");
export const assertSuperAdminUserId = (userId: string) => assertRole(userId, "super_admin");
