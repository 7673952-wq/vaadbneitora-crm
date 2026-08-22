import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { getHandlingSpeedTrend } from "@/lib/systems.functions";
import { perfMark } from "@/lib/perf";
import { Gauge } from "lucide-react";

const PERIODS: Array<{ value: "day" | "3days" | "week" | "month" | "year"; label: string }> = [
  { value: "day", label: "יום" },
  { value: "3days", label: "3 ימים" },
  { value: "week", label: "שבוע" },
  { value: "month", label: "חודש" },
  { value: "year", label: "שנה" },
];

export function HandlingSpeedChart() {
  const [period, setPeriod] = useState<"day" | "3days" | "week" | "month" | "year">("week");
  const [compare, setCompare] = useState(false);
  const trendFn = useServerFn(getHandlingSpeedTrend);
  const { data, isLoading } = useQuery({
    queryKey: ["handlingSpeed", period, compare],
    queryFn: () => trendFn({ data: { period, compareToPrevious: compare } }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  useEffect(() => { if (data) perfMark("CHARTS_READY"); }, [data]);

  const rows = data ?? [];

  const totalHandled = rows.reduce((sum, r) => sum + (r.throughput ?? 0), 0);
  const weighted = rows.reduce((sum, r) => sum + (r.avgHours ?? 0) * (r.throughput ?? 0), 0);
  const overallAvg = totalHandled > 0 ? (weighted / totalHandled).toFixed(1) : "—";
  const totalPrev = rows.reduce((s, r: any) => s + (r.throughputPrev ?? 0), 0);
  const deltaPct = compare && totalPrev > 0 ? Math.round(((totalHandled - totalPrev) / totalPrev) * 100) : null;

  return (
    <div className="bg-gradient-to-br from-sky-50/50 via-card to-card border border-border rounded-2xl shadow-sm hover:shadow-md transition p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center">
            <Gauge className="h-4 w-4 text-emerald-700" />
          </span>
          מהירות טיפול
          <span className="text-xs text-muted-foreground font-normal">
            · {totalHandled} מערכות טופלו · ממוצע {overallAvg} שעות
            {deltaPct !== null && (
              <span className={`ms-1 font-semibold ${deltaPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                ({deltaPct >= 0 ? "+" : ""}{deltaPct}% מול תקופה קודמת)
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCompare((v) => !v)}
            className={`text-xs px-2 py-1.5 rounded-md border ${compare ? "bg-indigo-600 text-white border-indigo-600" : "border-input bg-white hover:bg-accent"}`}
            title="השווה לתקופה הקודמת">
            השוואה
          </button>
          <div className="flex rounded-md border border-input bg-white overflow-hidden">
            {PERIODS.map((p) => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={`text-xs px-2.5 py-1.5 transition ${period === p.value ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-accent"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="h-72">
        {isLoading && rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">טוען…</div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">אין נתונים לתקופה זו</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <defs>
                <linearGradient id="speed-hours-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="speed-count-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis yAxisId="hours" tick={{ fontSize: 11 }} stroke="#10b981" axisLine={false} tickLine={false}
                label={{ value: "שעות ממוצע", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#10b981" } }} />
              <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 11 }} stroke="#6366f1" axisLine={false} tickLine={false}
                label={{ value: "מס' מערכות", angle: 90, position: "insideRight", style: { fontSize: 11, fill: "#6366f1" } }} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="hours" type="monotone" dataKey="avgHours" fill="url(#speed-hours-grad)" stroke="none" legendType="none" />
              <Area yAxisId="count" type="monotone" dataKey="throughput" fill="url(#speed-count-grad)" stroke="none" legendType="none" />
              <Line yAxisId="hours" type="monotone" dataKey="avgHours" name="שעות ממוצע לטיפול" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line yAxisId="count" type="monotone" dataKey="throughput" name="מערכות שנסגרו" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              {compare && (
                <>
                  <Line yAxisId="hours" type="monotone" dataKey="avgHoursPrev" name="שעות (תקופה קודמת)" stroke="#10b981" strokeDasharray="5 4" strokeWidth={2} dot={false} />
                  <Line yAxisId="count" type="monotone" dataKey="throughputPrev" name="מערכות (תקופה קודמת)" stroke="#6366f1" strokeDasharray="5 4" strokeWidth={2} dot={false} />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
