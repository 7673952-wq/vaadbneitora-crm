import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
  status: z.string().max(60).nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { assertPermission, hasRole } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "systems_read", "yemot");
    if (!(await hasRole(context.userId, "admin"))) {
      throw new Error("מסכי מנהלים זמינים למנהלים בלבד");
    }
    const sb = context.supabase;

    // Base query for systems with optional filters
    let baseQ = sb.from("systems").select(
      "id, system_code, name, status, assigned_agent_id, parent_system_id, created_at, updated_at",
    );
    if (data.status) baseQ = baseQ.eq("status", data.status as any);
    if (data.agent_id) baseQ = baseQ.eq("assigned_agent_id", data.agent_id);

    // For status/agent breakdowns we look at ALL current systems (filtered).
    const { data: allSystems, error: allErr } = await baseQ;
    if (allErr) throw new Error(allErr.message);

    // For "in period" we need systems opened/updated in the date window.
    let openedInRange: any[] = [];
    let updatedInRange: any[] = [];
    if (data.from || data.to) {
      let openedQ = sb.from("systems").select("id, status, assigned_agent_id, created_at");
      if (data.from) openedQ = openedQ.gte("created_at", data.from);
      if (data.to) openedQ = openedQ.lte("created_at", data.to);
      if (data.status) openedQ = openedQ.eq("status", data.status as any);
      if (data.agent_id) openedQ = openedQ.eq("assigned_agent_id", data.agent_id);
      const { data: oRows } = await openedQ;
      openedInRange = oRows ?? [];

      let updQ = sb.from("systems").select("id, status, assigned_agent_id, updated_at");
      if (data.from) updQ = updQ.gte("updated_at", data.from);
      if (data.to) updQ = updQ.lte("updated_at", data.to);
      if (data.status) updQ = updQ.eq("status", data.status as any);
      if (data.agent_id) updQ = updQ.eq("assigned_agent_id", data.agent_id);
      const { data: uRows } = await updQ;
      updatedInRange = uRows ?? [];
    } else {
      openedInRange = (allSystems ?? []).map((s: any) => ({
        id: s.id, status: s.status, assigned_agent_id: s.assigned_agent_id, created_at: s.created_at,
      }));
      updatedInRange = (allSystems ?? []).map((s: any) => ({
        id: s.id, status: s.status, assigned_agent_id: s.assigned_agent_id, updated_at: s.updated_at,
      }));
    }

    // Closed in range — from activity log where field=status & new_value=closed
    let closedCount = 0;
    {
      let logQ = sb
        .from("system_activity_log")
        .select("id, system_id, new_value, created_at", { count: "exact", head: true })
        .eq("field", "status")
        .eq("new_value", "closed");
      if (data.from) logQ = logQ.gte("created_at", data.from);
      if (data.to) logQ = logQ.lte("created_at", data.to);
      const { count } = await logQ;
      closedCount = count ?? 0;
    }

    const { data: profiles } = await sb.from("profiles").select("id, display_name");
    const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));

    // By status — count from openedInRange (systems created in period, or all if no period)
    const byStatusMap = new Map<string, number>();
    for (const s of allSystems ?? []) {
      byStatusMap.set(s.status, (byStatusMap.get(s.status) ?? 0) + 1);
    }
    const byStatus = Array.from(byStatusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    // By agent — across all (filtered) systems
    const byAgentMap = new Map<string, { total: number; open: number; closed: number; pending: number }>();
    for (const s of allSystems ?? []) {
      const k = s.assigned_agent_id ?? "__unassigned";
      const cur = byAgentMap.get(k) ?? { total: 0, open: 0, closed: 0, pending: 0 };
      cur.total += 1;
      if (s.status === "open" || s.status === "to_open") cur.open += 1;
      else if (s.status === "closed" || s.status === "to_block" || s.status === "block_from_root") cur.closed += 1;
      else if (s.status === "pending_check_close" || s.status === "pending_check_open") cur.pending += 1;
      byAgentMap.set(k, cur);
    }
    const byAgent = Array.from(byAgentMap.entries()).map(([id, v]) => ({
      agent_id: id === "__unassigned" ? null : id,
      agent_name: id === "__unassigned" ? "לא משויך" : (pmap.get(id) ?? "לא ידוע"),
      ...v,
    })).sort((a, b) => b.total - a.total);

    // By sub-systems — for each parent (no parent_system_id) count children
    const parents = (allSystems ?? []).filter((s: any) => !s.parent_system_id);
    const allChildrenQ = await sb.from("systems")
      .select("id, parent_system_id, status").not("parent_system_id", "is", null);
    const allChildren = allChildrenQ.data ?? [];
    const childByParent = new Map<string, any[]>();
    for (const c of allChildren) {
      const arr = childByParent.get(c.parent_system_id) ?? [];
      arr.push(c);
      childByParent.set(c.parent_system_id, arr);
    }
    const bySubsystem = parents.map((p: any) => {
      const kids = childByParent.get(p.id) ?? [];
      const open = kids.filter((k) => k.status === "open" || k.status === "to_open").length;
      const closed = kids.filter((k) => k.status === "closed" || k.status === "to_block" || k.status === "block_from_root").length;
      const pending = kids.filter((k) => k.status === "pending_check_close" || k.status === "pending_check_open").length;
      return {
        parent_id: p.id,
        system_code: p.system_code,
        name: p.name,
        total_subs: kids.length,
        open,
        closed,
        pending,
      };
    }).filter((r) => r.total_subs > 0).sort((a, b) => b.total_subs - a.total_subs);

    return {
      byStatus,
      byAgent,
      bySubsystem,
      period: {
        opened: openedInRange.length,
        updated: updatedInRange.length,
        closed: closedCount,
      },
    };
  });
