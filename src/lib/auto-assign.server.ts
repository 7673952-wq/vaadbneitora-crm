// Status-based automatic agent assignment.
//
// Statuses can declare `assigned_agent_ids` in the status settings
// (ניהול > סטטוסים > שיוך אוטומטי לנציג). When a system is created with
// such a status — or moved into it — the system is assigned to one of those
// agents. When several agents are configured the load is balanced: the agent
// with the fewest currently-assigned unhandled systems wins, and the rest are
// added as reminder recipients so they still see the system.

import { readStatusSettings } from "@/lib/status-settings";

export type AutoAssignResult = {
  agentId: string;
  otherAgentIds: string[];
} | null;

export async function resolveAutoAssign(supabase: any, statusKey: string | null | undefined): Promise<AutoAssignResult> {
  if (!statusKey) return null;
  let settings: Array<{ status_key: string; assigned_agent_ids?: string[] }> = [];
  try {
    settings = (await readStatusSettings(supabase)) as any;
  } catch {
    return null;
  }
  const ids = (settings.find((row) => row.status_key === statusKey)?.assigned_agent_ids ?? [])
    .filter((id) => typeof id === "string" && id.trim());
  if (ids.length === 0) return null;
  if (ids.length === 1) return { agentId: ids[0], otherAgentIds: [] };

  // Balance across the configured agents by current workload.
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  try {
    const { data } = await supabase
      .from("systems")
      .select("assigned_agent_id")
      .in("assigned_agent_id", ids);
    for (const row of (data ?? []) as Array<{ assigned_agent_id: string | null }>) {
      if (row.assigned_agent_id && counts.has(row.assigned_agent_id)) {
        counts.set(row.assigned_agent_id, (counts.get(row.assigned_agent_id) ?? 0) + 1);
      }
    }
  } catch {
    // Fall back to the configured order when the count query fails.
  }
  const agentId = ids.reduce((best, id) => ((counts.get(id) ?? 0) < (counts.get(best) ?? 0) ? id : best), ids[0]);
  return { agentId, otherAgentIds: ids.filter((id) => id !== agentId) };
}
