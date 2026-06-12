import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, Legend,
} from "recharts";

type Datum = { name: string; value: number; color?: string };

function ChartCard({ title, subtitle, accent, children, height = 260 }: {
  title: string; subtitle?: string; accent: string;
  children: React.ReactNode; height?: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="p-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as any}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg text-xs">
      <div className="font-semibold text-foreground">{p.payload.name}</div>
      <div className="text-muted-foreground mt-0.5">
        <span className="font-mono font-bold text-foreground">{p.value}</span> מערכות
      </div>
    </div>
  );
}

export function ChartGrid({ chartData, agentChartData, trendData, large = false }: {
  chartData: Datum[]; agentChartData: Datum[]; trendData: Datum[]; large?: boolean;
}) {
  const h = large ? 380 : 260;
  const total = chartData.reduce((s, d) => s + d.value, 0);
  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${large ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
        {chartData.length > 0 && (
          <ChartCard title="התפלגות סטטוסים" subtitle={`סה"כ ${total} מערכות`} accent="#6366f1" height={h}>
            <PieChart>
              <defs>
                {chartData.map((d, i) => (
                  <linearGradient key={i} id={`pie-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                    <stop offset="100%" stopColor={d.color} stopOpacity={0.7} />
                  </linearGradient>
                ))}
              </defs>
              <Pie data={chartData} dataKey="value" nameKey="name"
                innerRadius={large ? 80 : 56} outerRadius={large ? 140 : 96}
                paddingAngle={3} stroke="#fff" strokeWidth={2}
                label={large ? ({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%` : undefined}>
                {chartData.map((_, i) => <Cell key={i} fill={`url(#pie-grad-${i})`} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              {large && <Legend wrapperStyle={{ fontSize: 11 }} />}
            </PieChart>
          </ChartCard>
        )}

        {chartData.length > 0 && (
          <ChartCard title="כמות לפי סטטוס" subtitle="מספר מערכות בכל סטטוס" accent="#10b981" height={h}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 50, left: 0 }}>
              <defs>
                {chartData.map((d, i) => (
                  <linearGradient key={i} id={`bar-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                    <stop offset="100%" stopColor={d.color} stopOpacity={0.55} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#475569" }} interval={0} angle={-25} textAnchor="end" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#475569" }} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#0f172a08" }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={60}>
                {chartData.map((_, i) => <Cell key={i} fill={`url(#bar-grad-${i})`} />)}
              </Bar>
            </BarChart>
          </ChartCard>
        )}

        {agentChartData.length > 0 && (
          <ChartCard title="מערכות לפי נציג" subtitle="עומס מערכות פעיל" accent="#8b5cf6" height={h}>
            <BarChart data={agentChartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="agent-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#475569" }} allowDecimals={false} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#0f172a" }} width={100} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#0f172a08" }} />
              <Bar dataKey="value" fill="url(#agent-grad)" radius={[0, 8, 8, 0]} maxBarSize={28} />
            </BarChart>
          </ChartCard>
        )}
      </div>

      {trendData.length > 1 && (
        <ChartCard title="פעילות לפי תאריך" subtitle="עדכון אחרון של מערכות" accent="#0891b2" height={large ? 320 : 200}>
          <AreaChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0891b2" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#0891b2" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#475569" }} allowDecimals={false} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="value" stroke="#0891b2" strokeWidth={2.5} fill="url(#trend-grad)" />
          </AreaChart>
        </ChartCard>
      )}
    </div>
  );
}
