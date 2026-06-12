import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function isAdminUserId(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
}

export async function isSuperAdminUserId(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
}

export async function assertAdminUserId(userId: string) {
  const isAdmin = await isAdminUserId(userId);
  if (!isAdmin) throw new Error("רק מנהל יכול לבצע פעולה זו");
}

export async function assertSuperAdminUserId(userId: string) {
  const isSuper = await isSuperAdminUserId(userId);
  if (!isSuper) throw new Error("רק מנהל ראשי יכול לבצע פעולה זו");
}
