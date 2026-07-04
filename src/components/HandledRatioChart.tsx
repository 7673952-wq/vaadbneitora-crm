import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { getHandledRatio } from "@/lib/systems.functions";
import { PieChart as PieIcon } from "lucide-react";

const PERIODS: Array<{ value: "day" | "3days" | "week" | "month" | "year"; label: string }> = [
  { value: "day", label: "יום" },
  { value: "3days", label: "3 ימים" },
  { value: "week", label: "שבוע" },
  { value: "month", label: "חודש" },
  { value: "year", label: "שנה" },
];

export function HandledRatioChart() {
  const [period, setPeriod] = useState<"day" | "3days" | "week" | "month" | "year">("week");
  const fn = useServerFn(getHandledRatio);
  const { data, isLoading } = useQuery({
    queryKey: ["handledRatio", period],
    queryFn: () => fn({ data: { period } }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const handled = data?.handled ?? 0;
  const notHandled = data?.notHandled ?? 0;
  const total = data?.total ?? 0;
  const pct = total > 0 ? Math.round((handled / total) * 100) : 0;

  const chartData = [
    { name: "טופלו", value: handled, color: "#10b981" },
    { name: "לא טופלו", value: notHandled, color: "#ef4444" },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl shadow-soft p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <PieIcon className="h-4 w-4 text-primary" />
          אחוז פניות שטופלו
          <span className="text-xs text-muted-foreground font-normal">
            · {handled}/{total} פניות · {pct}%
          </span>
        </div>
        <div className="flex rounded-md border border-input bg-white overflow-hidden">
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`text-xs px-2.5 py-1.5 transition ${period === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-72">
        {isLoading && total === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">טוען…</div>
        ) : total === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">אין נתונים לתקופה זו</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                innerRadius={55} outerRadius={95} paddingAngle={2}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}>
                {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [`${v} פניות`, ""]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
