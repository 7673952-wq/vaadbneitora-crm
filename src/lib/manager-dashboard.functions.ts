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

// Group systems by caller phone. Includes primary caller_phone as well as
// entries from additional_caller_phones (jsonb array of {phone}).
export const getSystemsByCallerPhone = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("systems")
      .select("id, system_code, name, status, caller_phone, phone, additional_caller_phones, assigned_agent_id, created_at");
    if (error) throw new Error(error.message);

    const norm = (p: any): string | null => {
      if (!p) return null;
      const s = String(p).replace(/[^\d+]/g, "");
      return s.length >= 4 ? s : null;
    };

    const groups = new Map<string, { phone: string; systems: any[] }>();
    for (const row of data ?? []) {
      const phones = new Set<string>();
      const primary = norm((row as any).caller_phone) || norm((row as any).phone);
      if (primary) phones.add(primary);
      const extras = Array.isArray((row as any).additional_caller_phones) ? (row as any).additional_caller_phones : [];
      for (const e of extras) {
        const p = norm(e?.phone);
        if (p) phones.add(p);
      }
      for (const p of phones) {
        if (!groups.has(p)) groups.set(p, { phone: p, systems: [] });
        groups.get(p)!.systems.push(row);
      }
    }

    return Array.from(groups.values())
      .filter((g) => g.systems.length > 1)
      .map((g) => ({ phone: g.phone, count: g.systems.length, systems: g.systems }))
      .sort((a, b) => b.count - a.count);
  });
