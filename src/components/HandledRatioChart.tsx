import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { getHandledRatio } from "@/lib/systems.functions";
import { PieChart as PieIcon } from "lucide-react";

type Period = "day" | "3days" | "week" | "month" | "year";
type Within = 1 | 3 | 7 | 30;

const OPENED_PERIODS: Array<{ value: Period; label: string }> = [
  { value: "day", label: "יום" },
  { value: "3days", label: "3 ימים" },
  { value: "week", label: "שבוע" },
  { value: "month", label: "חודש" },
  { value: "year", label: "שנה" },
];

const WITHIN_OPTS: Array<{ value: Within; label: string }> = [
  { value: 1, label: "יום" },
  { value: 3, label: "3 ימים" },
  { value: 7, label: "שבוע" },
  { value: 30, label: "חודש" },
];

// Draws the % label OUTSIDE the ring (past outerRadius) with a short leader
// line to its slice. Recharts' built-in function-label positions text right
// at the slice boundary, where the next slice's fill (drawn after it) can
// paint over it — this keeps labels clear of the pie entirely.
function OutsideLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent, fill } = props;
  if (!percent) return null;
  const RAD = Math.PI / 180;
  const sin = Math.sin(-midAngle * RAD);
  const cos = Math.cos(-midAngle * RAD);
  const lineStart = { x: cx + (outerRadius + 4) * cos, y: cy + (outerRadius + 4) * sin };
  const lineEnd = { x: cx + (outerRadius + 18) * cos, y: cy + (outerRadius + 18) * sin };
  const textAnchor = cos >= 0 ? "start" : "end";
  const textX = lineEnd.x + (cos >= 0 ? 4 : -4);
  return (
    <g>
      <path d={`M${lineStart.x},${lineStart.y}L${lineEnd.x},${lineEnd.y}`} stroke={fill} strokeWidth={1.5} fill="none" />
      <circle cx={lineEnd.x} cy={lineEnd.y} r={2} fill={fill} />
      <text x={textX} y={lineEnd.y} textAnchor={textAnchor} dominantBaseline="central"
        fontSize={12} fontWeight={700} fill="var(--foreground, #0f172a)">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    </g>
  );
}

export function HandledRatioChart() {
  const [openedPeriod, setOpenedPeriod] = useState<Period>("week");
  const [withinDays, setWithinDays] = useState<Within>(3);
  const fn = useServerFn(getHandledRatio);
  const { data, isLoading } = useQuery({
    queryKey: ["handledRatio", openedPeriod, withinDays],
    queryFn: () => fn({ data: { openedPeriod, withinDays } }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const handled = data?.handledInTime ?? 0;
  const notHandled = data?.notHandledInTime ?? 0;
  const total = data?.total ?? 0;
  const pct = total > 0 ? Math.round((handled / total) * 100) : 0;

  const chartData = [
    { name: `טופלו בזמן`, value: handled, color: "#10b981" },
    { name: `לא טופלו בזמן`, value: notHandled, color: "#ef4444" },
  ];

  const withinLabel = WITHIN_OPTS.find((w) => w.value === withinDays)?.label ?? "";

  return (
    <div className="bg-gradient-to-br from-emerald-50/50 via-card to-card border border-border rounded-2xl shadow-sm hover:shadow-md transition p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center">
            <PieIcon className="h-4 w-4 text-emerald-700" />
          </span>
          אחוז מערכות שטופלו בזמן
          <span className="text-xs text-muted-foreground font-normal">
            · {handled}/{total} · {pct}%
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">נפתחו ב־</span>
          <div className="flex rounded-md border border-input bg-white overflow-hidden">
            {OPENED_PERIODS.map((p) => (
              <button key={p.value} onClick={() => setOpenedPeriod(p.value)}
                className={`px-2.5 py-1 transition ${openedPeriod === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">טופלו תוך</span>
          <div className="flex rounded-md border border-input bg-white overflow-hidden">
            {WITHIN_OPTS.map((w) => (
              <button key={w.value} onClick={() => setWithinDays(w.value)}
                className={`px-2.5 py-1 transition ${withinDays === w.value ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-accent"}`}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-72 relative">
        {isLoading && total === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">טוען…</div>
        ) : total === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">אין נתונים לתקופה זו</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 20, right: 40, bottom: 20, left: 40 }}>
                <defs>
                  {chartData.map((d, i) => (
                    <linearGradient key={i} id={`ratio-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                      <stop offset="100%" stopColor={d.color} stopOpacity={0.75} />
                    </linearGradient>
                  ))}
                </defs>
                <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={60} outerRadius={92} paddingAngle={3} cornerRadius={4}
                  stroke="#fff" strokeWidth={2}
                  label={OutsideLabel} labelLine={false}>
                  {chartData.map((entry, i) => <Cell key={i} fill={`url(#ratio-grad-${i})`} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [`${v} מערכות`, ""]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label: overall handled % */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center -mt-6">
              <div className="text-2xl font-bold text-foreground">{pct}%</div>
              <div className="text-[10px] text-muted-foreground">תוך {withinLabel}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
