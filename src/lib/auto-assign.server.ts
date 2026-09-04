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
  // Only *unhandled* systems count as workload — a closed system is not work.
  const handledKeys = (settings as Array<{ status_key: string; is_handled?: boolean }>)
    .filter((row) => row.is_handled)
    .map((row) => row.status_key);
  try {
    let query = supabase
      .from("systems")
      .select("assigned_agent_id")
      .in("assigned_agent_id", ids);
    if (handledKeys.length) query = query.not("status", "in", `(${handledKeys.join(",")})`);
    const { data } = await query;
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

/**
 * Applies a status-driven automatic assignment through the atomic RPC.
 *
 * The RPC sets `app.change_reason` and performs the UPDATE inside ONE
 * transaction — a separate `set_change_reason` call would be lost, because the
 * setting is transaction-local. The status change itself must already have been
 * written (with its real reason) by a separate UPDATE, so it stays visible in
 * the activity log while only the follow-up assignment is marked as automatic.
 *
 * Idempotent: the RPC only touches rows whose agent actually differs.
 */
export async function applyAutoStatusAssignment(
  supabaseAdmin: any,
  systemId: string,
  agentId: string,
  reminderAgentIds?: string[] | null,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("apply_auto_status_assignment", {
    _system_id: systemId,
    _agent_id: agentId,
    _reminder_agent_ids: reminderAgentIds && reminderAgentIds.length ? reminderAgentIds : null,
  });
  // A technical RPC failure is NOT the same as "nothing changed": it must
  // propagate so the caller can retry instead of stamping the work as done.
  if (error) throw new Error(`שיוך אוטומטי לנציג נכשל: ${error.message}`);
  return Boolean(data);
}

