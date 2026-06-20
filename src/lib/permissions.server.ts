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

/**
 * Throws when the caller is read-only (viewer or no role). Use at the top of
 * EVERY write server fn so viewers can never mutate data even if RLS permits it.
 */
export async function assertCanWrite(userId: string): Promise<void> {
  const ok = await hasRole(userId, "agent");
  if (!ok) {
    throw new AppError("למשתמשי צפייה אין הרשאת עריכה", { code: "forbidden" });
  }
}
