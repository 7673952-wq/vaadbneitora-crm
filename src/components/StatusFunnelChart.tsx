import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from "recharts";
import { getStatusFunnel } from "@/lib/systems.functions";
import { Filter } from "lucide-react";

type Period = "day" | "3days" | "week" | "month" | "year" | "all";

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "day", label: "יום" },
  { value: "3days", label: "3 ימים" },
  { value: "week", label: "שבוע" },
  { value: "month", label: "חודש" },
  { value: "year", label: "שנה" },
  { value: "all", label: "הכל" },
];

const TONE_COLORS: Record<string, string> = {
  green: "#10b981", lightgreen: "#86efac", emerald: "#34d399",
  red: "#ef4444", lightred: "#fca5a5", brightred: "#dc2626", darkred: "#991b1b",
  amber: "#f59e0b", orange: "#f97316", yellow: "#eab308",
  teal: "#14b8a6", cyan: "#06b6d4", sky: "#0ea5e9", indigo: "#6366f1",
  violet: "#8b5cf6", purple: "#a855f7", fuchsia: "#d946ef", pink: "#ec4899",
  black: "#0f172a", gray: "#64748b",
};

export function StatusFunnelChart() {
  const [period, setPeriod] = useState<Period>("week");
  const fn = useServerFn(getStatusFunnel);
  const { data, isLoading } = useQuery({
    queryKey: ["statusFunnel", period],
    queryFn: () => fn({ data: { period } }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const rows = (data ?? []).filter((r: any) => r.count > 0);
  const total = rows.reduce((s: number, r: any) => s + r.count, 0);

  return (
    <div className="bg-gradient-to-br from-violet-50/50 via-card to-card border border-border rounded-2xl shadow-sm hover:shadow-md transition p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-7 w-7 rounded-lg bg-violet-100 flex items-center justify-center">
            <Filter className="h-4 w-4 text-violet-700" />
          </span>
          משפך סטטוסים
          <span className="text-xs text-muted-foreground font-normal">· {total} מערכות</span>
        </div>
        <div className="flex rounded-md border border-input bg-white overflow-hidden">
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`text-xs px-2.5 py-1.5 transition ${period === p.value ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-accent"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-80">
        {isLoading && rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">טוען…</div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">אין נתונים</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={130} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [`${v} מערכות`, ""]} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {rows.map((r: any, i: number) => (
                  <Cell key={i} fill={TONE_COLORS[r.tone] ?? "#6366f1"} />
                ))}
                <LabelList dataKey="count" position="right" style={{ fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
