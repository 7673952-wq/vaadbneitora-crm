import { supabase } from "@/integrations/supabase/client";

export async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("נדרש להתחבר מחדש");
  return { Authorization: `Bearer ${token}` };
}