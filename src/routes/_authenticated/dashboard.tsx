import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSystems, listAgents, createSystem, updateSystem,
  listDueReminders, dismissReminder, findSystemByName, addSubSystem,
} from "@/lib/systems.functions";
import { getMyRole } from "@/lib/admin.functions";
import {
  STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, toneClasses,
  statusCardClasses, type SystemStatus,
  CALLER_SOURCES, buildDialNumber,
} from "@/lib/status";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Download, Search, Filter, X, Bell, BellOff, Phone, CornerUpRight, CheckCircle2 } from "lucide-react";
import { ChevronDown, ChevronUp, ExternalLink, BarChart3 } from "lucide-react";
import { ChartGrid } from "@/components/ChartGrid";
import * as XLSX from "xlsx";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "דשבורד | CRM" }] }),
  component: Dashboard,
});

type Period = "" | "day" | "week" | "month" | "year";

const PIE_COLORS = ["#059669", "#84cc16", "#dc2626", "#fb7185", "#f59e0b", "#eab308", "#0284c7", "#4f46e5", "#0891b2", "#7c3aed", "#c026d3", "#ea580c", "#334155"];

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listSystems);
  const agentsFn = useServerFn(listAgents);
  const meFn = useServerFn(getMyRole);
  const createFn = useServerFn(createSystem);
  const updateFn = useServerFn(updateSystem);
  const dueFn = useServerFn(listDueReminders);
  const dismissFn = useServerFn(dismissReminder);

  const [status, setStatus] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [period, setPeriod] = useState<Period>("");
  const [search, setSearch] = useState("");
  const [pdfDate, setPdfDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [showCreate, setShowCreate] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showCharts, setShowCharts] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("dashboardChartsOpen") === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dashboardChartsOpen", showCharts ? "1" : "0");
    }
  }, [showCharts]);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });
  const { data: systems, isLoading } = useQuery({
    queryKey: ["systems", status, agentId, period],
    queryFn: () => listFn({ data: { status: status || null, agentId: agentId || null, period: period || null } }),
  });
  const { data: dueReminders } = useQuery({
    queryKey: ["dueReminders"],
    queryFn: () => dueFn(),
    refetchInterval: 60_000,
  });

  const dismissMut = useMutation({
    mutationFn: dismissFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dueReminders"] }); qc.invalidateQueries({ queryKey: ["systems"] }); },
  });

  const filtered = useMemo(() => {
    if (!systems) return [];
    if (!search.trim()) return systems;
    const s = search.trim().toLowerCase();
    return systems.filter((r: any) => {
      const nameMatch = r.name?.toLowerCase().includes(s);
      const codeMatch = r.system_code?.toLowerCase().includes(s);
      const agentMatch = r.agent?.display_name?.toLowerCase().includes(s);
      const statusMatch = (STATUS_LABEL[r.status as SystemStatus] || "").includes(s);
      const phoneMatch = (r.phone || "").includes(s);
      return nameMatch || codeMatch || agentMatch || statusMatch || phoneMatch;
    });
  }, [systems, search]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => { counts[s.status] = (counts[s.status] || 0) + 1; });
    return counts;
  }, [systems]);
  const chartData = useMemo(() => STATUS_OPTIONS
    .map((s, i) => ({ name: s.label, value: stats[s.value] ?? 0, color: PIE_COLORS[i % PIE_COLORS.length] }))
    .filter((item) => item.value > 0), [stats]);

  const agentChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => {
      const n = s.agent?.display_name ?? "לא משויך";
      counts[n] = (counts[n] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [systems]);

  const trendData = useMemo(() => {
    const buckets: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => {
      const d = new Date(s.updated_at);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      buckets[key] = (buckets[key] || 0) + 1;
    });
    return Object.entries(buckets).slice(-14).map(([name, value]) => ({ name, value }));
  }, [systems]);

  // Pending sections
  const pendingClose = filtered.filter((r: any) => r.status === "pending_check_close");
  const pendingOpen = filtered.filter((r: any) => r.status === "pending_check_open");
  const handledRecently = useMemo(() => {
    const dayAgo = Date.now() - 1000 * 60 * 60 * 24 * 7; // last week
    return filtered.filter((r: any) => r.handled_pending_at && new Date(r.handled_pending_at).getTime() >= dayAgo);
  }, [filtered]);
  const rest = filtered.filter((r: any) =>
    r.status !== "pending_check_close" &&
    r.status !== "pending_check_open" &&
    !handledRecently.some((h: any) => h.id === r.id),
  );

  const updateMutation = useMutation({
    mutationFn: updateFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["systems"] }); qc.invalidateQueries({ queryKey: ["dueReminders"] }); toast.success("עודכן"); },
    onError: (e: any) => toast.error(e.message),
  });

  function filterByRange(rows: any[], fromIso: string | null, toIso: string | null) {
    if (!fromIso && !toIso) return rows;
    const from = fromIso ? new Date(fromIso).getTime() : -Infinity;
    const to = toIso ? new Date(toIso).getTime() : Infinity;
    return rows.filter((r: any) => {
      const t = new Date(r.updated_at).getTime();
      return t >= from && t <= to;
    });
  }

  function exportCsv(rows: any[], label: string) {
    if (!rows.length) { toast.info("אין נתונים לייצוא"); return; }
    const header = ["מזהה מערכת", "שם", "סטטוס", "נציג מטפל", "טלפון", "פונה", "תת-מערכת של", "הערות", "עדכון אחרון"];
    const data = rows.map((r: any) => [
      r.system_code, r.name, STATUS_LABEL[r.status as SystemStatus] || r.status,
      r.agent?.display_name || "", r.phone || "", r.caller_phone || "",
      r.parent ? `${r.parent.system_code} / ${r.parent.name}` : "",
      (r.notes || "").replace(/\n/g, " "), new Date(r.updated_at).toLocaleString("he-IL"),
    ]);
    const csv = "\uFEFF" + [header, ...data].map((row) =>
      row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `systems_${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdfRows(rows: any[], label: string) {
    if (!rows.length) { toast.info("אין נתונים לייצוא בטווח זה"); return; }
    const statusLabel = status ? (STATUS_LABEL[status as SystemStatus] || status) : "כל הסטטוסים";
    const tableRows = rows.map((r: any) => `
      <tr>
        <td>${r.system_code ?? ""}</td>
        <td>${r.name ?? ""}</td>
        <td>${STATUS_LABEL[r.status as SystemStatus] || r.status}</td>
        <td>${r.agent?.display_name ?? "—"}</td>
        <td>${r.caller_phone ?? ""}</td>
        <td>${(r.notes ?? "").replace(/</g, "&lt;")}</td>
        <td>${new Date(r.updated_at).toLocaleString("he-IL")}</td>
      </tr>`).join("");
    const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8" />
      <title>דוח מערכות ${label}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        body { font-family: 'Heebo', Arial, sans-serif; color: #0f172a; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .meta { color: #64748b; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: right; vertical-align: top; }
        th { background: #f1f5f9; font-weight: 600; }
        tr:nth-child(even) td { background: #fafafa; }
        .footer { margin-top: 12px; font-size: 11px; color: #94a3b8; }
      </style></head><body>
      <h1>דוח מערכות</h1>
      <div class="meta">טווח: ${label} · סטטוס: ${statusLabel} · סה"כ: ${rows.length}</div>
      <table>
        <thead><tr><th>מזהה</th><th>שם מערכת</th><th>סטטוס</th><th>נציג מטפל</th><th>פונה</th><th>הערות</th><th>עדכון אחרון</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="footer">הופק ב-${new Date().toLocaleString("he-IL")}</div>
      <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("חסום על ידי דפדפן — אפשר חלונות קופצים"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function exportCrmXlsx(rows: any[], label: string) {
    const filteredRows = rows.filter((r: any) => r.status === "to_block" || r.status === "to_open");
    if (!filteredRows.length) { toast.info("אין מערכות בסטטוס לחסום/לפתוח בטווח זה"); return; }
    const data = filteredRows.map((r: any) => ({
      phone_number: buildDialNumber(r.system_code),
      caller_id: buildDialNumber(r.caller_phone || r.phone || r.system_code),
      active: 1,
      call_type: "ALL",
      status: r.status === "to_block" ? "BLOCKED" : "OPEN",
    }));
    const ws = XLSX.utils.json_to_sheet(data, { header: ["phone_number", "caller_id", "active", "call_type", "status"] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CRM");
    XLSX.writeFile(wb, `crm_block_open_${label}.xlsx`);
  }

  function exportFullXlsx(rows: any[], label: string) {
    if (!rows.length) { toast.info("אין נתונים לייצוא"); return; }
    const data = rows.map((r: any) => ({
      "מזהה מערכת": r.system_code,
      "שם": r.name,
      "סטטוס": STATUS_LABEL[r.status as SystemStatus] || r.status,
      "נציג מטפל": r.agent?.display_name || "",
      "טלפון": r.phone || "",
      "פונה": r.caller_phone || "",
      "מקור": r.source || "",
      "תת-מערכת של": r.parent ? `${r.parent.system_code} / ${r.parent.name}` : "",
      "הערות": r.notes || "",
      "עדכון אחרון": new Date(r.updated_at).toLocaleString("he-IL"),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Systems");
    XLSX.writeFile(wb, `systems_${label}.xlsx`);
  }


  return (
    <div className="space-y-6">
      {/* Due reminders banner */}
      {dueReminders && dueReminders.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-900 font-semibold">
            <Bell className="h-4 w-4" />תזכורות שהגיעו ({dueReminders.length})
          </div>
          <div className="space-y-1.5">
            {dueReminders.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 bg-white/70 rounded-lg p-2.5 text-sm">
                <Link to="/systems/$id" params={{ id: r.id }} className="flex-1 min-w-0 flex items-center gap-2 hover:underline">
                  <span className="text-xs font-mono text-muted-foreground">{r.system_code}</span>
                  <span className="font-medium truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">· {new Date(r.reminder_at).toLocaleString("he-IL")}</span>
                </Link>
                <button onClick={() => dismissMut.mutate({ data: { system_id: r.id } })}
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border border-amber-300 hover:bg-amber-100 text-amber-900">
                  <BellOff className="h-3 w-3" />סגור
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">דשבורד מערכות</h1>
          <p className="text-muted-foreground text-sm mt-1">סה"כ {systems?.length ?? 0} מערכות · מציג {filtered.length}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowExport(true)} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
            <Download className="h-4 w-4" />ייצוא לפי תאריכים
          </button>
          {me?.isAdmin && (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Plus className="h-4 w-4" />הוסף מערכת
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {STATUS_OPTIONS.map((s) => {
          const active = status === s.value;
          return (
            <button key={s.value} type="button"
              onClick={() => setStatus(active ? "" : s.value)}
              className={`border-2 rounded-xl p-3 text-right transition ${statusCardClasses(s.value)} ${active ? "ring-2 ring-primary ring-offset-2" : ""}`}>
              <div className="text-xs opacity-80 truncate">{s.label}</div>
              <div className="text-2xl font-bold mt-1">{stats[s.value] ?? 0}</div>
            </button>
          );
        })}
      </div>

      {(chartData.length > 0 || agentChartData.length > 0) && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-indigo-50 via-sky-50 to-emerald-50 border-b border-border">
            <button onClick={() => setShowCharts(!showCharts)}
              className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BarChart3 className="h-4 w-4 text-indigo-600" />
              תרשימים וניתוח נתונים
              {showCharts ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2">
              <a href="/charts" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input bg-white hover:bg-accent">
                <ExternalLink className="h-3 w-3" />פתח בלשונית נפרדת
              </a>
              <button onClick={() => setShowCharts(!showCharts)}
                className="text-xs px-2.5 py-1.5 rounded-md border border-input bg-white hover:bg-accent">
                {showCharts ? "סגור" : "הצג"}
              </button>
            </div>
          </div>
          {showCharts && (
            <div className="p-4">
              <ChartGrid chartData={chartData} agentChartData={agentChartData} trendData={trendData} />
            </div>
          )}
        </div>
      )}



      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />סינון:
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי מערכת, שם, נציג, טלפון או סטטוס..."
            className="pr-9 pl-3 py-2 text-sm rounded-lg border border-input bg-background w-72 focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הסטטוסים</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הנציגים</option>
          {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הזמנים</option>
          <option value="day">יומי</option>
          <option value="week">שבועי</option>
          <option value="month">חודשי</option>
          <option value="year">שנתי</option>
        </select>
        {(status || agentId || period || search) && (
          <button onClick={() => { setStatus(""); setAgentId(""); setPeriod(""); setSearch(""); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />נקה סינון
          </button>
        )}
      </div>

      {/* Pending sections */}
      {(pendingClose.length > 0 || pendingOpen.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          <PendingGroup title="לבדיקה לחסימה" items={pendingClose} agents={agents ?? []} onUpdate={(d) => updateMutation.mutate({ data: d })} />
          <PendingGroup title="לבדיקה לפתיחה" items={pendingOpen} agents={agents ?? []} onUpdate={(d) => updateMutation.mutate({ data: d })} />
        </div>
      )}

      {/* Handled */}
      {handledRecently.length > 0 && (
        <details className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />טופל לאחרונה ({handledRecently.length})
          </summary>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
            {handledRecently.map((r: any) => (
              <SystemCard key={r.id} r={r} compact />
            ))}
          </div>
        </details>
      )}

      {/* Main cards grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">כל המערכות ({rest.length})</h2>
        {isLoading && <div className="text-center py-12 text-muted-foreground">טוען...</div>}
        {!isLoading && rest.length === 0 && <div className="text-center py-12 text-muted-foreground">לא נמצאו מערכות</div>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rest.map((r: any) => (
            <SystemCard key={r.id} r={r} agents={agents ?? []} onUpdate={(d) => updateMutation.mutate({ data: d })} />
          ))}
        </div>
      </div>

      {showCreate && me?.isAdmin && (
        <CreateModal onClose={() => setShowCreate(false)} agents={agents ?? []} onDone={() => {
          qc.invalidateQueries({ queryKey: ["systems"] });
          setShowCreate(false);
        }} />
      )}

      {showExport && (
        <ExportModal
          allRows={systems ?? []}
          onClose={() => setShowExport(false)}
          onExport={(format, fromIso, toIso, label) => {
            const rows = filterByRange(systems ?? [], fromIso, toIso);
            if (format === "csv") exportCsv(rows, label);
            else if (format === "pdf") exportPdfRows(rows, label);
            else if (format === "xlsx") exportFullXlsx(rows, label);
            else if (format === "crm") exportCrmXlsx(rows, label);
            setShowExport(false);
          }}
        />
      )}
    </div>
  );
}


function PendingGroup({ title, items, agents, onUpdate }: { title: string; items: any[]; agents: any[]; onUpdate: (d: any) => void }) {
  return (
    <div className="bg-card border-2 border-amber-300 rounded-xl p-4">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-amber-600" />{title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">אין פניות ממתינות</div>
      ) : (
        <div className="space-y-2">
          {items.map((r: any) => (
            <SystemCard key={r.id} r={r} agents={agents} onUpdate={onUpdate} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemCard({ r, agents, onUpdate, compact }: { r: any; agents?: any[]; onUpdate?: (d: any) => void; compact?: boolean }) {
  const navigate = useNavigate();
  const cardCls = statusCardClasses(r.status);
  return (
    <div onClick={() => navigate({ to: "/systems/$id", params: { id: r.id } })}
      className={`border-2 rounded-xl p-3 cursor-pointer transition ${cardCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono opacity-80">{r.system_code}</span>
            {r.parent_system_id && (
              <span className="text-[10px] bg-white/60 text-amber-900 border border-amber-300 rounded-full px-1.5 py-0.5 font-medium flex items-center gap-0.5">
                <CornerUpRight className="h-2.5 w-2.5" />תת-מערכת
              </span>
            )}
            {r.reminder_at && new Date(r.reminder_at) <= new Date() && (
              <Bell className="h-3 w-3 text-amber-700" />
            )}
          </div>
          <div className="font-semibold text-sm mt-0.5 truncate">{r.name}</div>
          {r.parent && (
            <div className="text-[11px] opacity-70 truncate mt-0.5">
              של: {r.parent.system_code} · {r.parent.name}
            </div>
          )}
        </div>
        <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium shrink-0 ${toneClasses(STATUS_TONE[r.status as SystemStatus])}`}>
          {STATUS_LABEL[r.status as SystemStatus]}
        </span>
      </div>

      {!compact && (
        <div className="grid grid-cols-2 gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
          <select value={r.status} onChange={(e) => {
            const newStatus = e.target.value;
            if (newStatus === r.status) return;
            const reason = window.prompt("סיבת שינוי הסטטוס (חובה):", "");
            if (!reason || !reason.trim()) { toast.error("יש להזין סיבה"); return; }
            onUpdate?.({ id: r.id, status: newStatus, reason: reason.trim() });
          }}
            className="text-[11px] rounded-md border border-input bg-background/90 px-1.5 py-1 text-foreground">
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={r.assigned_agent_id || ""} onChange={(e) => onUpdate?.({ id: r.id, assigned_agent_id: e.target.value || null })}
            className="text-[11px] rounded-md border border-input bg-background/90 px-1.5 py-1 text-foreground">
            <option value="">— לא משויך —</option>
            {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
        </div>
      )}


      <div className="mt-2 space-y-1 text-[11px] opacity-90" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">נציג: {r.agent?.display_name ?? "לא משויך"}</span>
          {r.system_code && (
            <a href={`tel:${buildDialNumber(r.system_code)}`}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-mono">
              <Phone className="h-2.5 w-2.5" />{r.system_code}
            </a>
          )}
        </div>
        {r.caller_phone && (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">פונה: {r.caller_phone}</span>
            <a href={`tel:${buildDialNumber(r.caller_phone)}`}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600 text-white hover:bg-sky-700 font-mono">
              <Phone className="h-2.5 w-2.5" />{r.caller_phone}
            </a>
          </div>
        )}
      </div>

    </div>
  );
}

function CreateModal({ onClose, agents, onDone }: { onClose: () => void; agents: any[]; onDone: () => void }) {
  const [form, setForm] = useState({ system_code: "", name: "", status: "open", assigned_agent_id: "", notes: "", phone: "", caller_phone: "", source: "" });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [matchedParent, setMatchedParent] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const findFn = useServerFn(findSystemByName);
  const createFn = useServerFn(createSystem);
  const subFn = useServerFn(addSubSystem);

  useEffect(() => {
    const v = form.name.trim();
    if (v.length < 2) { setSuggestions([]); setMatchedParent(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await findFn({ data: { name: v } });
        if (cancelled) return;
        setSuggestions(rows ?? []);
        const exact = (rows ?? []).find((r: any) => r.name.trim().toLowerCase() === v.toLowerCase() && !r.parent_system_id);
        setMatchedParent(exact ?? null);
      } catch { /* ignore */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.name, findFn]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (matchedParent) {
        await subFn({ data: {
          parent_id: matchedParent.id,
          system_code: form.system_code,
          name: form.name.trim() || undefined,
          source: form.source,
          caller_phone: form.caller_phone,
        } });
        toast.success(`נוספה תת-מערכת למערכת "${matchedParent.name}"`);
      } else {
        await createFn({ data: {
          system_code: form.system_code,
          name: form.name,
          status: form.status,
          assigned_agent_id: form.assigned_agent_id || null,
          notes: form.notes,
          phone: buildDialNumber(form.system_code) || form.phone || undefined,
          source: form.source,
          caller_phone: form.caller_phone,
        } });
        toast.success("נוסף בהצלחה");
      }
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">הוספת מערכת חדשה</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">מזהה מערכת (מספר לחיוג)</label>
            <input required value={form.system_code} onChange={(e) => setForm({ ...form, system_code: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="relative">
            <label className="text-sm font-medium block mb-1">שם המערכת</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoComplete="off"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            {suggestions.length > 0 && form.name.trim().length >= 2 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((s: any) => (
                  <button type="button" key={s.id}
                    onClick={() => setForm({ ...form, name: s.name })}
                    className="w-full text-right px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2">
                    <span className="truncate"><span className="font-mono text-xs text-muted-foreground">{s.system_code}</span> · {s.name}</span>
                    {s.parent_system_id && <CornerUpRight className="h-3 w-3 text-amber-600 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
            {matchedParent && (
              <div className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2">
                שם זה כבר קיים — היצירה תתבצע כ-<strong>תת-מערכת</strong> תחת "{matchedParent.name}".
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">טלפון לחיוג (אופציונלי)</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="נוצר אוטומטית לפי מזהה המערכת"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">טלפון פונה</label>
            <input required value={form.caller_phone} onChange={(e) => setForm({ ...form, caller_phone: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">מקור</label>
            <select required value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">— בחר מקור —</option>
              {CALLER_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {!matchedParent && (
            <>
              <div>
                <label className="text-sm font-medium block mb-1">סטטוס</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
                המערכת תיפתח אוטומטית על שמך כנציג המטפל. ניתן לשייך לנציג אחר לאחר הפתיחה.
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">הערות</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
            </>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent">ביטול</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {busy ? "..." : matchedParent ? "הוסף תת-מערכת" : "הוסף"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type ExportFormat = "csv" | "pdf" | "xlsx" | "crm";
type RangePreset = "day" | "week" | "month" | "year" | "all" | "custom";

function ExportModal({ allRows, onClose, onExport }: {
  allRows: any[];
  onClose: () => void;
  onExport: (format: ExportFormat, fromIso: string | null, toIso: string | null, label: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [preset, setPreset] = useState<RangePreset>("month");
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [format, setFormat] = useState<ExportFormat>("xlsx");

  function computeRange(): { fromIso: string | null; toIso: string | null; label: string } {
    if (preset === "all") return { fromIso: null, toIso: null, label: "all" };
    if (preset === "custom") {
      if (!from || !to) return { fromIso: null, toIso: null, label: "custom" };
      return {
        fromIso: new Date(from + "T00:00:00").toISOString(),
        toIso: new Date(to + "T23:59:59.999").toISOString(),
        label: `${from}_${to}`,
      };
    }
    const now = new Date();
    const start = new Date(now);
    if (preset === "day") start.setHours(0, 0, 0, 0);
    else if (preset === "week") start.setDate(now.getDate() - 7);
    else if (preset === "month") start.setMonth(now.getMonth() - 1);
    else if (preset === "year") start.setFullYear(now.getFullYear() - 1);
    return { fromIso: start.toISOString(), toIso: now.toISOString(), label: preset };
  }

  const countInRange = (() => {
    const { fromIso, toIso } = computeRange();
    if (!fromIso && !toIso) return allRows.length;
    const f = fromIso ? new Date(fromIso).getTime() : -Infinity;
    const t = toIso ? new Date(toIso).getTime() : Infinity;
    return allRows.filter((r) => {
      const u = new Date(r.updated_at).getTime();
      return u >= f && u <= t;
    }).length;
  })();

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-1">ייצוא לפי תאריכים</h2>
        <p className="text-xs text-muted-foreground mb-4">סינון לפי תאריך עדכון אחרון של המערכת</p>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-2">טווח תאריכים</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: "day", l: "יומי" },
                { v: "week", l: "שבועי" },
                { v: "month", l: "חודשי" },
                { v: "year", l: "שנתי" },
                { v: "all", l: "הכל" },
                { v: "custom", l: "בחירת תאריכים" },
              ] as { v: RangePreset; l: string }[]).map((p) => (
                <button key={p.v} type="button" onClick={() => setPreset(p.v)}
                  className={`text-sm py-2 rounded-lg border ${preset === p.v ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-accent"}`}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>

          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">מתאריך</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">עד תאריך</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium block mb-2">פורמט</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "xlsx", l: "Excel מלא" },
                { v: "csv", l: "CSV" },
                { v: "pdf", l: "PDF להדפסה" },
                { v: "crm", l: "Excel CRM (חסום/פתוח)" },
              ] as { v: ExportFormat; l: string }[]).map((f) => (
                <button key={f.v} type="button" onClick={() => setFormat(f.v)}
                  className={`text-sm py-2 rounded-lg border ${format === f.v ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-accent"}`}>
                  {f.l}
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
            יישלחו לייצוא: <strong>{countInRange}</strong> מערכות
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent">ביטול</button>
            <button type="button" onClick={() => {
              const { fromIso, toIso, label } = computeRange();
              onExport(format, fromIso, toIso, label);
            }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              ייצא
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

