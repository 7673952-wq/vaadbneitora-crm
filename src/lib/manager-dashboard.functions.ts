import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getManagerDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const monthAgo = new Date(now);
    monthAgo.setMonth(now.getMonth() - 1);

    // All of these are independent of one another — fetch in one round-trip
    // instead of 3 sequential stages (this was a big chunk of why opening the
    // manager dashboard felt slow).
    const [
      openedWeekRes, closedWeekLogRes, pendingRes, overdueRes, openedMonthRes,
      logsRes, profilesRes, overdueListRes,
    ] = await Promise.all([
      sb.from("systems").select("id", { count: "exact", head: true }).gte("created_at", weekAgo.toISOString()),
      sb.from("system_activity_log").select("id", { count: "exact", head: true })
        .eq("field", "status").eq("new_value", "closed").gte("created_at", weekAgo.toISOString()),
      sb.from("systems").select("id", { count: "exact", head: true })
        .in("status", ["pending_check_close", "pending_check_open"] as any),
      sb.from("systems").select("id", { count: "exact", head: true })
        .lt("reminder_at", now.toISOString()).not("reminder_at", "is", null),
      sb.from("systems").select("id", { count: "exact", head: true }).gte("created_at", monthAgo.toISOString()),
      // Per-agent performance — activity log entries last 7 days
      sb.from("system_activity_log")
        .select("actor_id, action, created_at")
        .gte("created_at", weekAgo.toISOString())
        .not("actor_id", "is", null),
      sb.from("profiles").select("id, display_name"),
      // Overdue reminders list
      sb.from("systems")
        .select("id, system_code, name, reminder_at, assigned_agent_id")
        .lt("reminder_at", now.toISOString())
        .not("reminder_at", "is", null)
        .order("reminder_at", { ascending: true })
        .limit(20),
    ]);

    const logs = logsRes.data;
    const profiles = profilesRes.data;
    const overdueList = overdueListRes.data;

    const perAgent = new Map<string, number>();
    for (const l of logs ?? []) {
      if (!l.actor_id) continue;
      perAgent.set(l.actor_id, (perAgent.get(l.actor_id) ?? 0) + 1);
    }

    const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));

    const agentPerformance = Array.from(perAgent.entries()).map(([id, count]) => ({
      agent_id: id,
      agent_name: pmap.get(id) ?? "לא ידוע",
      actions: count,
    })).sort((a, b) => b.actions - a.actions);

    return {
      kpis: {
        openedThisWeek: openedWeekRes.count ?? 0,
        closedThisWeek: closedWeekLogRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        overdueReminders: overdueRes.count ?? 0,
        openedThisMonth: openedMonthRes.count ?? 0,
      },
      agentPerformance,
      overdueList: (overdueList ?? []).map((s: any) => ({
        ...s,
        agent_name: s.assigned_agent_id ? pmap.get(s.assigned_agent_id) ?? "לא ידוע" : "לא משויך",
      })),
    };
  });
