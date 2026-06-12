import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getReports } from "@/lib/reports.functions";
import { listAgents } from "@/lib/systems.functions";
import { STATUS_OPTIONS, STATUS_LABEL, toneClasses } from "@/lib/status";
import { Download, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "דוחות | CRM" }] }),
  component: ReportsPage,
});

type Period = "" | "day" | "week" | "month" | "year" | "custom";

function periodToRange(p: Period): { from: string | null; to: string | null } {
  if (!p || p === "custom") return { from: null, to: null };
  const now = new Date();
  const from = new Date(now);
  if (p === "day") from.setDate(now.getDate() - 1);
  else if (p === "week") from.setDate(now.getDate() - 7);
  else if (p === "month") from.setMonth(now.getMonth() - 1);
  else if (p === "year") from.setFullYear(now.getFullYear() - 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

function downloadCSV(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const reportsFn = useServerFn(getReports);
  const agentsFn = useServerFn(listAgents);

  const [period, setPeriod] = useState<Period>("");
  const [status, setStatus] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [tab, setTab] = useState<"status" | "agent" | "period" | "subs">("status");

  const range = useMemo(() => {
    if (period === "custom") {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : null,
        to: customTo ? new Date(customTo + "T23:59:59").toISOString() : null,
      };
    }
    return periodToRange(period);
  }, [period, customFrom, customTo]);

  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });
  const { data: report, isLoading } = useQuery({
    queryKey: ["reports", range.from, range.to, status, agentId],
    queryFn: () => reportsFn({ data: { from: range.from, to: range.to, status: status || null, agent_id: agentId || null } }),
  });

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">דוחות</h1>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">תקופה</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm min-w-[140px]">
            <option value="">הכל</option>
            <option value="day">היום</option>
            <option value="week">השבוע</option>
            <option value="month">החודש</option>
            <option value="year">השנה</option>
            <option value="custom">טווח מותאם</option>
          </select>
        </div>
        {period === "custom" && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">מ-</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-background border border-border rounded-md px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">עד</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="bg-background border border-border rounded-md px-3 py-2 text-sm" />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">סטטוס</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm min-w-[160px]">
            <option value="">הכל</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">נציג</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm min-w-[160px]">
            <option value="">הכל</option>
            {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { id: "status", label: "לפי סטטוס" },
          { id: "agent", label: "לפי נציג" },
          { id: "period", label: "לפי תקופה" },
          { id: "subs", label: "תתי-מערכות" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-muted-foreground py-12 text-center">טוען...</div>}
      {!isLoading && report && (
        <>
          {tab === "status" && <StatusReport rows={report.byStatus} />}
          {tab === "agent" && <AgentReport rows={report.byAgent} />}
          {tab === "period" && <PeriodReport period={report.period} hasRange={!!(range.from || range.to)} />}
          {tab === "subs" && <SubsReport rows={report.bySubsystem} />}
        </>
      )}
    </div>
  );
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent">
      <Download className="h-4 w-4" /> ייצוא CSV
    </button>
  );
}

function StatusReport({ rows }: { rows: { status: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">סה״כ {total} מערכות</div>
        <ExportBtn onClick={() => downloadCSV("report-by-status.csv", ["סטטוס", "כמות"],
          rows.map((r) => [STATUS_LABEL[r.status] ?? r.status, r.count]))} />
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="text-right p-3">סטטוס</th><th className="text-right p-3 w-32">כמות</th><th className="text-right p-3">פילוג</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.status} className="border-t border-border">
                <td className="p-3"><span className={`inline-block px-2 py-0.5 rounded text-xs ${toneClasses("default")}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                <td className="p-3 font-semibold">{r.count}</td>
                <td className="p-3">
                  <div className="h-2 bg-muted rounded">
                    <div className="h-full bg-primary rounded" style={{ width: `${(r.count / max) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">אין נתונים</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgentReport({ rows }: { rows: { agent_id: string | null; agent_name: string; total: number; open: number; closed: number; pending: number }[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">סה״כ {rows.length} נציגים</div>
        <ExportBtn onClick={() => downloadCSV("report-by-agent.csv",
          ["נציג", "סה״כ", "פתוחות", "חסומות", "ממתינות"],
          rows.map((r) => [r.agent_name, r.total, r.open, r.closed, r.pending]))} />
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-right p-3">נציג</th>
              <th className="text-right p-3">סה״כ</th>
              <th className="text-right p-3">פתוחות</th>
              <th className="text-right p-3">חסומות</th>
              <th className="text-right p-3">ממתינות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent_id ?? "u"} className="border-t border-border">
                <td className="p-3 font-medium">{r.agent_name}</td>
                <td className="p-3 font-semibold">{r.total}</td>
                <td className="p-3 text-emerald-700">{r.open}</td>
                <td className="p-3 text-red-700">{r.closed}</td>
                <td className="p-3 text-amber-700">{r.pending}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">אין נתונים</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodReport({ period, hasRange }: { period: { opened: number; updated: number; closed: number }; hasRange: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{hasRange ? "בטווח שנבחר" : "כל הזמנים"}</div>
        <ExportBtn onClick={() => downloadCSV("report-by-period.csv",
          ["מדד", "כמות"],
          [["נפתחו", period.opened], ["עודכנו", period.updated], ["נחסמו (סטטוס שונה לחסום)", period.closed]])} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="נפתחו" value={period.opened} tone="emerald" />
        <Stat label="עודכנו" value={period.updated} tone="sky" />
        <Stat label="נחסמו" value={period.closed} tone="red" />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "sky" | "red" }) {
  const cls = tone === "emerald" ? "bg-emerald-50 border-emerald-300 text-emerald-900"
    : tone === "sky" ? "bg-sky-50 border-sky-300 text-sky-900"
    : "bg-red-50 border-red-300 text-red-900";
  return (
    <div className={`border rounded-xl p-5 ${cls}`}>
      <div className="text-sm opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-2">{value}</div>
    </div>
  );
}

function SubsReport({ rows }: { rows: { parent_id: string; system_code: string; name: string; total_subs: number; open: number; closed: number; pending: number }[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">סה״כ {rows.length} מערכות-אב עם תתי-מערכות</div>
        <ExportBtn onClick={() => downloadCSV("report-subsystems.csv",
          ["מזהה", "שם", "סך תתי", "פתוחות", "חסומות", "ממתינות"],
          rows.map((r) => [r.system_code, r.name, r.total_subs, r.open, r.closed, r.pending]))} />
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-right p-3">מזהה</th>
              <th className="text-right p-3">שם</th>
              <th className="text-right p-3">סך תתי</th>
              <th className="text-right p-3">פתוחות</th>
              <th className="text-right p-3">חסומות</th>
              <th className="text-right p-3">ממתינות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.parent_id} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{r.system_code}</td>
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3 font-semibold">{r.total_subs}</td>
                <td className="p-3 text-emerald-700">{r.open}</td>
                <td className="p-3 text-red-700">{r.closed}</td>
                <td className="p-3 text-amber-700">{r.pending}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">אין נתונים</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
