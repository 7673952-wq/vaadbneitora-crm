import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function isAdminUserId(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
}

export async function assertAdminUserId(userId: string) {
  const isAdmin = await isAdminUserId(userId);
  if (!isAdmin) throw new Error("רק מנהל יכול לבצע פעולה זו");
}