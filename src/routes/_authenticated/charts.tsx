import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listSystems } from "@/lib/systems.functions";
import { STATUS_OPTIONS } from "@/lib/status";
import { ChartGrid } from "@/components/ChartGrid";
import { HandlingSpeedChart } from "@/components/HandlingSpeedChart";
import { HandledRatioChart } from "@/components/HandledRatioChart";
import { StatusFunnelChart } from "@/components/StatusFunnelChart";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/charts")({
  head: () => ({ meta: [{ title: "תרשימים | CRM" }] }),
  component: ChartsPage,
});

const PIE_COLORS = ["#059669", "#84cc16", "#dc2626", "#fb7185", "#f59e0b", "#eab308", "#0284c7", "#4f46e5", "#0891b2", "#7c3aed", "#c026d3", "#ea580c", "#334155"];

function ChartsPage() {
  const listFn = useServerFn(listSystems);
  const { data: systems } = useQuery({
    queryKey: ["systems", "", "", ""],
    queryFn: async () => (await listFn({ data: { status: null, agentId: null, period: null } })).items,
  });

  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => { c[s.status] = (c[s.status] || 0) + 1; });
    return c;
  }, [systems]);

  const chartData = useMemo(() => STATUS_OPTIONS
    .map((s, i) => ({ name: s.label, value: stats[s.value] ?? 0, color: PIE_COLORS[i % PIE_COLORS.length] }))
    .filter((d) => d.value > 0), [stats]);

  const agentChartData = useMemo(() => {
    const c: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => {
      const n = s.agent?.display_name ?? "לא משויך";
      c[n] = (c[n] || 0) + 1;
    });
    return Object.entries(c).map(([name, value]) => ({ name, value }));
  }, [systems]);

  const trendData = useMemo(() => {
    const buckets: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => {
      const d = new Date(s.updated_at);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      buckets[key] = (buckets[key] || 0) + 1;
    });
    return Object.entries(buckets).slice(-30).map(([name, value]) => ({ name, value }));
  }, [systems]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="h-4 w-4" />חזרה לדשבורד
      </Link>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">תרשימים וניתוח נתונים</h1>
        <p className="text-muted-foreground text-sm mt-1">סה"כ {systems?.length ?? 0} מערכות</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HandlingSpeedChart />
        <HandledRatioChart />
      </div>
      <ChartGrid chartData={chartData} agentChartData={agentChartData} trendData={trendData} large />
    </div>
  );
}
