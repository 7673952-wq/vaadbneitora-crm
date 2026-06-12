import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getManagerDashboard } from "@/lib/manager-dashboard.functions";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { LayoutDashboard, AlertTriangle, CheckCircle2, Clock, TrendingUp, Plus, BarChart3, ArrowLeft, Database } from "lucide-react";

export const Route = createFileRoute("/_authenticated/manager-dashboard")({
  head: () => ({ meta: [{ title: "דשבורד מנהלים | CRM" }] }),
  component: ManagerDashboard,
});

function ManagerDashboard() {
  const meFn = useServerFn(getMyRole);
  const fn = useServerFn(getManagerDashboard);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({ headers: await getAuthHeaders() }) });
  const { data, isLoading } = useQuery({
    queryKey: ["manager-dashboard"],
    queryFn: async () => fn({ headers: await getAuthHeaders() }),
    enabled: me?.isAdmin === true,
  });

  if (me && !me.isAdmin) {
    return <div className="text-center py-20"><h2 className="text-xl font-semibold">אין הרשאה</h2><p className="text-muted-foreground mt-2">דף זה מיועד למנהלים בלבד.</p></div>;
  }
  if (isLoading || !data) {
    return <div className="text-center py-20 text-muted-foreground">טוען נתונים...</div>;
  }

  const maxPerf = Math.max(1, ...data.agentPerformance.map((a) => a.actions));

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">דשבורד מנהלים</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/reports" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
            <BarChart3 className="h-4 w-4" />
            דוחות מפורטים
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link to="/backups" className="flex items-center gap-2 border border-border px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent">
            <Database className="h-4 w-4" />
            גיבויים
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="נפתחו השבוע" value={data.kpis.openedThisWeek} icon={<Plus className="h-5 w-5" />} tone="emerald" />
        <KpiCard label="נסגרו השבוע" value={data.kpis.closedThisWeek} icon={<CheckCircle2 className="h-5 w-5" />} tone="sky" />
        <KpiCard label="ממתינות לבדיקה" value={data.kpis.pending} icon={<Clock className="h-5 w-5" />} tone="amber" />
        <KpiCard label="מעקבים באיחור" value={data.kpis.overdueReminders} icon={<AlertTriangle className="h-5 w-5" />} tone="red" />
        <KpiCard label="נפתחו החודש" value={data.kpis.openedThisMonth} icon={<TrendingUp className="h-5 w-5" />} tone="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Per-agent performance */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-4">ביצועים לפי נציג (7 ימים אחרונים)</h2>
          {data.agentPerformance.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">אין פעילות השבוע</div>
          ) : (
            <div className="space-y-3">
              {data.agentPerformance.map((a) => (
                <div key={a.agent_id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{a.agent_name}</span>
                    <span className="text-muted-foreground">{a.actions} פעולות</span>
                  </div>
                  <div className="h-2 bg-muted rounded">
                    <div className="h-full bg-primary rounded transition-all" style={{ width: `${(a.actions / maxPerf) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Overdue reminders list */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            מעקבים באיחור
          </h2>
          {data.overdueList.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">אין מעקבים באיחור</div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {data.overdueList.map((s: any) => {
                const date = new Date(s.reminder_at);
                const daysOverdue = Math.floor((Date.now() - date.getTime()) / 86400000);
                return (
                  <Link key={s.id} to="/systems/$id" params={{ id: s.id }}
                    className="block border border-border rounded-lg p-3 hover:bg-accent transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{s.system_code}</div>
                        <div className="text-xs text-muted-foreground mt-1">נציג: {s.agent_name}</div>
                      </div>
                      <div className="text-left shrink-0">
                        <div className="text-xs text-red-700 font-semibold">{daysOverdue} ימים</div>
                        <div className="text-xs text-muted-foreground">{date.toLocaleDateString("he-IL")}</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "emerald" | "sky" | "amber" | "red" | "violet" }) {
  const toneCls: Record<string, string> = {
    emerald: "bg-emerald-50 border-emerald-300 text-emerald-900",
    sky: "bg-sky-50 border-sky-300 text-sky-900",
    amber: "bg-amber-50 border-amber-300 text-amber-900",
    red: "bg-red-50 border-red-300 text-red-900",
    violet: "bg-violet-50 border-violet-300 text-violet-900",
  };
  return (
    <div className={`border rounded-xl p-4 ${toneCls[tone]}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm opacity-80">{label}</div>
        <div className="opacity-70">{icon}</div>
      </div>
      <div className="text-3xl font-bold mt-2">{value}</div>
    </div>
  );
}
