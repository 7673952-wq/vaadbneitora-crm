/** Server-only helper: the Gmail label routing configured in ניהול → תיבת דואר. */
import { parseMailboxPrefs } from "@/lib/mailbox-prefs";

export async function getGmailLabelRouting(): Promise<{ label: string; archive: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "mailbox_prefs")
    .maybeSingle();
  const prefs = parseMailboxPrefs(data?.value);
  return { label: (prefs.gmailLabel ?? "").trim(), archive: !!prefs.gmailArchive };
}
