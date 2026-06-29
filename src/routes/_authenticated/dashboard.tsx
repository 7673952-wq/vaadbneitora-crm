import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSystems, listAgents, createSystem, updateSystem,
  listDueReminders, dismissReminder, snoozeReminder, findSystemByName, findSystemByCode, addSubSystem,
  importSystems, getStatusCounts,
} from "@/lib/systems.functions";
import { getMyRole, listStatusSettings, getStaleWarningHours } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import {
  STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, STATUS_HANDLED, toneClasses,
  statusCardClasses, applyStatusSettings, NO_REASON_STATUSES, type SystemStatus,
  CALLER_SOURCES, buildDialNumber,
} from "@/lib/status";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Download, Search, Filter, X, Bell, BellOff, Phone, CornerUpRight, CheckCircle2, Clock, Moon, Upload, LayoutGrid, Columns3, CheckSquare, Square } from "lucide-react";
import { ChevronDown, ChevronUp, ExternalLink, BarChart3, Mail } from "lucide-react";
import { ChartGrid } from "@/components/ChartGrid";
import * as XLSX from "xlsx";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "דשבורד | CRM" }] }),
  component: Dashboard,
});

type Period = "" | "day" | "week" | "month" | "year";
type CreateInitial = { system_code?: string; name?: string; parent_id?: string; createMode?: "root" | "sub" };

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
  const snoozeFn = useServerFn(snoozeReminder);
  const statusSettingsFn = useServerFn(listStatusSettings);
  const staleHoursFn = useServerFn(getStaleWarningHours);
  const { data: statusSettings } = useQuery({ queryKey: ["status_settings"], queryFn: () => statusSettingsFn() });
  const { data: staleSetting } = useQuery({ queryKey: ["stale_warning_hours"], queryFn: () => staleHoursFn() });
  const staleHours = staleSetting?.hours ?? 0;
  useEffect(() => { if (statusSettings) applyStatusSettings(statusSettings as any); }, [statusSettings]);

  const [status, setStatus] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [period, setPeriod] = useState<Period>("");
  const [search, setSearch] = useState("");
  const [pdfDate, setPdfDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);
  const [showCreate, setShowCreate] = useState(false);
  const [createInitial, setCreateInitial] = useState<CreateInitial>({});
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "kanban">(() => {
    if (typeof window === "undefined") return "list";
    return (window.localStorage.getItem("dashboardViewMode") as any) || "list";
  });
  useEffect(() => { if (typeof window !== "undefined") window.localStorage.setItem("dashboardViewMode", viewMode); }, [viewMode]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAgent, setBulkAgent] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const importFn = useServerFn(importSystems);
  const [showCharts, setShowCharts] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("dashboardChartsOpen") === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dashboardChartsOpen", showCharts ? "1" : "0");
    }
  }, [showCharts]);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({ headers: await getAuthHeaders() }) });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });
  const serverPageSize = pageSize === 0 ? 100000 : pageSize;
  const { data: systemsData, isLoading } = useQuery({
    queryKey: ["systems", status, agentId, period, page, pageSize],
    queryFn: async () => listFn({ data: { status: status || null, agentId: agentId || null, period: period || null, page, pageSize: serverPageSize } }),
  });
  const systems = systemsData?.items ?? [];
  const total = systemsData?.total ?? 0;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const statusCountsFn = useServerFn(getStatusCounts);
  const { data: globalStatusCounts } = useQuery({
    queryKey: ["statusCounts", agentId, period],
    queryFn: () => statusCountsFn({ data: { agentId: agentId || null, period: period || null } }),
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
  const snoozeMut = useMutation({
    mutationFn: snoozeFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dueReminders"] }); toast.success("נדחה"); },
    onError: (e: any) => toast.error(e.message),
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

  // Global per-status counts across ALL systems (not just the current page).
  const stats = useMemo(() => {
    if (globalStatusCounts) return globalStatusCounts as Record<string, number>;
    const counts: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => { counts[s.status] = (counts[s.status] || 0) + 1; });
    return counts;
  }, [systems, globalStatusCounts]);
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

  // Two-bucket split only: handled vs waiting. Pending-check statuses fall into "waiting" via STATUS_HANDLED.
  const restWaiting = useMemo(() => filtered.filter((r: any) => !STATUS_HANDLED[r.status]), [filtered, statusSettings]);
  const restHandled = useMemo(() => filtered.filter((r: any) => STATUS_HANDLED[r.status]), [filtered, statusSettings]);
  const rest = filtered;

  const updateMutation = useMutation({
    mutationFn: updateFn,
    // Optimistic update: patch every cached "systems" list immediately so the UI
    // reflects the change before the server responds. Roll back on error.
    onMutate: async (vars: any) => {
      await qc.cancelQueries({ queryKey: ["systems"] });
      const patch = vars?.data ?? {};
      const snapshots = qc.getQueriesData({ queryKey: ["systems"] });
      qc.setQueriesData({ queryKey: ["systems"] }, (old: any) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((r: any) => (r.id === patch.id ? { ...r, ...patch } : r)),
        };
      });
      return { snapshots };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.snapshots) {
        for (const [key, data] of ctx.snapshots) qc.setQueryData(key, data);
      }
      toast.error(e.message);
    },
    onSuccess: () => { toast.success("עודכן"); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["systems"] });
      qc.invalidateQueries({ queryKey: ["dueReminders"] });
    },
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function selectAllVisible() {
    setSelectedIds(new Set(filtered.map((r: any) => r.id)));
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function applyBulk() {
    if (selectedIds.size === 0) return;
    if (!bulkStatus && !bulkAgent) { toast.info("בחר סטטוס או נציג לעדכון"); return; }
    let reason = "";
    if (bulkStatus && !NO_REASON_STATUSES.has(bulkStatus)) {
      const r = window.prompt("סיבת שינוי סטטוס (חובה):", "");
      if (!r || !r.trim()) { toast.error("חובה להזין סיבה"); return; }
      reason = r.trim();
    }
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try {
        const patch: any = { id };
        if (bulkStatus) patch.status = bulkStatus;
        if (bulkAgent) patch.assigned_agent_id = bulkAgent === "__unassigned" ? null : bulkAgent;
        if (reason) patch.reason = reason;
        await updateMutation.mutateAsync({ data: patch });
        ok++;
      } catch { fail++; }
    }
    setBulkBusy(false);
    if (ok) toast.success(`עודכנו ${ok} מערכות`);
    if (fail) toast.error(`${fail} נכשלו`);
    clearSelection();
    setBulkStatus(""); setBulkAgent("");
  }

  async function handleKanbanDrop(id: string, newStatus: string) {
    const sys = (systems ?? []).find((s: any) => s.id === id);
    if (!sys || sys.status === newStatus) return;
    let reason = "";
    if (!NO_REASON_STATUSES.has(newStatus)) {
      const r = window.prompt(`סיבת שינוי סטטוס ל"${STATUS_LABEL[newStatus] || newStatus}":`, "");
      if (!r || !r.trim()) { toast.error("חובה להזין סיבה"); return; }
      reason = r.trim();
    }
    updateMutation.mutate({ data: { id, status: newStatus, ...(reason ? { reason } : {}) } });
  }


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
            <Bell className="h-4 w-4" />תזכורות לטיפול ({dueReminders.length})
          </div>
          <div className="space-y-1.5">
            {dueReminders.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 bg-white/70 rounded-lg p-2.5 text-sm">
                <Link to="/systems/$id" params={{ id: r.id }} className="flex-1 min-w-0 flex items-center gap-2 hover:underline">
                  <span className="text-xs font-mono text-muted-foreground">{r.system_code}</span>
                  <span className="font-medium truncate">{r.name}</span>
                  {r.source === "status" ? (
                    <span className="text-xs text-amber-800 shrink-0">· {STATUS_LABEL[r.status] || r.status}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0">· {new Date(r.reminder_at).toLocaleString("he-IL")}</span>
                  )}
                </Link>
                <div className="flex items-center gap-1 shrink-0">
                  <SnoozeMenu onSnooze={(minutes) => snoozeMut.mutate({ data: { system_id: r.id, minutes } })} />
                  <button onClick={() => dismissMut.mutate({ data: { system_id: r.id } })}
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border border-green-400 hover:bg-green-100 text-green-800 bg-white">
                    <CheckCircle2 className="h-3 w-3" />בוצע
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">דשבורד מערכות</h1>
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
            סה"כ {total} מערכות · מציג{" "}
            <select
              value={String(pageSize)}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="border-none bg-transparent p-0 text-sm font-medium text-foreground underline-offset-2 hover:underline focus:outline-none focus:ring-0 cursor-pointer"
              aria-label="מספר פריטים בעמוד"
              title="מספר פריטים בעמוד"
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="1000">1000</option>
              <option value="0">הכל</option>
            </select>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCharts(!showCharts)}
            title="תרשימים וניתוח נתונים"
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
            <BarChart3 className="h-4 w-4 text-indigo-600" />
            {showCharts ? "סגור תרשימים" : "תרשימים"}
          </button>
          {me?.isAgent && (
            <ImportExportMenu
              canExport={!!me?.isAdmin}
              onExport={() => setShowExport(true)}
              onImport={() => setShowImport(true)}
            />
          )}
          {me?.isAdmin && (
            <>
              {me?.isSuperAdmin && (
                <Link to="/admin" className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
                  ניהול
                </Link>
              )}
            </>
          )}
          {me?.isAgent && (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Plus className="h-4 w-4" />הוסף מערכת
            </button>
          )}
        </div>
      </div>

      {/* Quick lookup */}
      <QuickLookup onOpenCreate={(initial) => { setCreateInitial(initial ?? {}); setShowCreate(true); }} canCreate={!!me?.isAgent} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {STATUS_OPTIONS.map((s) => {
          const active = status === s.value;
          return (
            <button key={s.value} type="button"
              onClick={() => setStatus(active ? "" : s.value)}
              className={`border-2 rounded-lg p-2 text-right transition ${statusCardClasses(s.value)} ${active ? "ring-2 ring-primary ring-offset-2" : ""}`}>
              <div className="text-[11px] opacity-80 truncate">{s.label}</div>
              <div className="text-lg font-bold mt-0.5">{stats[s.value] ?? 0}</div>
            </button>
          );
        })}
      </div>

      {showCharts && (chartData.length > 0 || agentChartData.length > 0) && (
        <div className="bg-card border border-border rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="h-4 w-4 text-indigo-600" />תרשימים וניתוח נתונים
            </div>
            <a href="/charts" target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input bg-white hover:bg-accent">
              <ExternalLink className="h-3 w-3" />פתח בלשונית נפרדת
            </a>
          </div>
          <ChartGrid chartData={chartData} agentChartData={agentChartData} trendData={trendData} />
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
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הסטטוסים</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הנציגים</option>
          {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
        </select>
        <select value={period} onChange={(e) => { setPeriod(e.target.value as Period); setPage(1); }} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הזמנים</option>
          <option value="day">יומי</option>
          <option value="week">שבועי</option>
          <option value="month">חודשי</option>
          <option value="year">שנתי</option>
        </select>
        {(status || agentId || period || search) && (
          <button onClick={() => { setStatus(""); setAgentId(""); setPeriod(""); setSearch(""); setPage(1); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />נקה סינון
          </button>
        )}
        <div className="ms-auto flex items-center gap-2">
          {!me?.isViewer && (
            <button
              onClick={() => { setSelectMode((v) => !v); if (selectMode) clearSelection(); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border ${selectMode ? "bg-primary text-primary-foreground border-primary" : "border-input bg-white hover:bg-accent"}`}
              title="בחירה מרובה">
              {selectMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              בחירה מרובה
            </button>
          )}
          <div className="flex rounded-md border border-input bg-white overflow-hidden">
            <button onClick={() => setViewMode("list")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              title="תצוגת רשימה">
              <LayoutGrid className="h-3.5 w-3.5" />רשימה
            </button>
            <button onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs border-r border-input ${viewMode === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              title="תצוגת קנבן">
              <Columns3 className="h-3.5 w-3.5" />קנבן
            </button>
          </div>
        </div>
      </div>

      {selectMode && (
        <div className="bg-indigo-50 border-2 border-indigo-300 rounded-xl p-3 flex flex-wrap items-center gap-3 sticky top-2 z-30 shadow-sm">
          <div className="text-sm font-semibold text-indigo-900">
            נבחרו {selectedIds.size} מתוך {filtered.length}
          </div>
          <button onClick={selectAllVisible} className="text-xs px-2 py-1 rounded border border-indigo-400 bg-white hover:bg-indigo-100">בחר הכל</button>
          <button onClick={clearSelection} className="text-xs px-2 py-1 rounded border border-indigo-400 bg-white hover:bg-indigo-100">נקה</button>
          <div className="h-5 w-px bg-indigo-300" />
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="px-2 py-1 text-xs rounded border border-input bg-white">
            <option value="">— שנה סטטוס —</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={bulkAgent} onChange={(e) => setBulkAgent(e.target.value)} className="px-2 py-1 text-xs rounded border border-input bg-white">
            <option value="">— שנה נציג —</option>
            <option value="__unassigned">ללא שיוך</option>
            {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
          <button
            onClick={applyBulk}
            disabled={bulkBusy || selectedIds.size === 0 || (!bulkStatus && !bulkAgent)}
            className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {bulkBusy ? "מעדכן..." : "החל על הנבחרים"}
          </button>
        </div>
      )}

      {/* Main cards grid */}
      <div>
        {isLoading && <div className="text-center py-12 text-muted-foreground">טוען...</div>}
        {!isLoading && rest.length === 0 && <div className="text-center py-12 text-muted-foreground">לא נמצאו מערכות</div>}

        {viewMode === "kanban" ? (
          rest.length > 0 && (
            <KanbanBoard
              rows={filtered}
              agents={agents ?? []}
              canWrite={!me?.isViewer}
              staleHours={staleHours}
              onUpdate={(d) => updateMutation.mutate({ data: d })}
              onDropStatus={handleKanbanDrop}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          )
        ) : (
          <>
            {restWaiting.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />ממתין לטיפול ({restWaiting.length})
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {restWaiting.map((r: any) => (
                    <SystemCard key={r.id} r={r} agents={agents ?? []} canWrite={!me?.isViewer} staleHours={staleHours} onUpdate={(d) => updateMutation.mutate({ data: d })}
                      selectMode={selectMode} selected={selectedIds.has(r.id)} onToggleSelect={toggleSelect} />
                  ))}
                </div>
              </div>
            )}

            {restHandled.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />טופל ({restHandled.length})
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {restHandled.map((r: any) => (
                    <SystemCard key={r.id} r={r} agents={agents ?? []} canWrite={!me?.isViewer} staleHours={staleHours} onUpdate={(d) => updateMutation.mutate({ data: d })}
                      selectMode={selectMode} selected={selectedIds.has(r.id)} onToggleSelect={toggleSelect} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>


      {total > 0 && pageSize !== 0 && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={(e: any) => { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }}
                  className={page === 1 ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-3 py-2 text-sm tabular-nums">
                  עמוד {page} מתוך {totalPages}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={(e: any) => { e.preventDefault(); setPage((p) => Math.min(totalPages, p + 1)); }}
                  className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}


      {showCreate && me?.isAgent && (
        <CreateModal initial={createInitial} onClose={() => setShowCreate(false)} agents={agents ?? []} onDone={() => {
          qc.invalidateQueries({ queryKey: ["systems"] });
          setShowCreate(false);
          setCreateInitial({});
        }} />
      )}

      {showExport && (
        <ExportModal
          allRows={systems ?? []}
          agents={agents ?? []}
          onClose={() => setShowExport(false)}
          onExport={(format, fromIso, toIso, label, statusFilter, agentFilter) => {
            let rows = filterByRange(systems ?? [], fromIso, toIso);
            if (statusFilter.length > 0) rows = rows.filter((r: any) => statusFilter.includes(r.status));
            if (agentFilter.length > 0) rows = rows.filter((r: any) => agentFilter.includes(r.assigned_agent_id || "__unassigned"));
            if (format === "csv") exportCsv(rows, label);
            else if (format === "pdf") exportPdfRows(rows, label);
            else if (format === "xlsx") exportFullXlsx(rows, label);
            else if (format === "crm") exportCrmXlsx(rows, label);
            setShowExport(false);
          }}
        />
      )}

      {showImport && (
        <ImportModal
          agentNames={(agents ?? []).map((a: any) => a.display_name).filter(Boolean)}
          onClose={() => setShowImport(false)}
          onImport={async (rows) => {
            const res: any = await importFn({ data: { rows } });
            const parts: string[] = [];
            if (res.createdCount) parts.push(`נוצרו ${res.createdCount} מערכות`);
            if (res.incompleteRows?.length) parts.push(`${res.incompleteRows.length} עם פרטים חסרים`);
            if (parts.length) toast.success(parts.join(" · "));
            if (res.errors?.length) {
              toast.error(`${res.errors.length} שורות לא יובאו`);
            }
            qc.invalidateQueries({ queryKey: ["systems"] });
            return res;
          }}
        />
      )}

    </div>
  );
}


function SnoozeMenu({ onSnooze }: { onSnooze: (minutes: number) => void }) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("");
  const [customUnit, setCustomUnit] = useState<"min" | "hour" | "day">("hour");
  const presets: { label: string; minutes: number }[] = [
    { label: "15 דקות", minutes: 15 },
    { label: "שעה", minutes: 60 },
    { label: "3 שעות", minutes: 180 },
    { label: "מחר בבוקר (24ש')", minutes: 60 * 24 },
    { label: "3 ימים", minutes: 60 * 24 * 3 },
    { label: "שבוע", minutes: 60 * 24 * 7 },
  ];
  function submitCustom() {
    const n = parseInt(customVal, 10);
    if (!n || n <= 0) { toast.error("יש להזין מספר חיובי"); return; }
    const mult = customUnit === "min" ? 1 : customUnit === "hour" ? 60 : 60 * 24;
    onSnooze(n * mult);
    setOpen(false); setCustomOpen(false); setCustomVal("");
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        title="דחיית התזכורת"
        className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border border-amber-400 hover:bg-amber-100 text-amber-800 bg-white">
        <Moon className="h-3 w-3" />דחה
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setCustomOpen(false); }} />
          <div className="absolute z-50 mt-1 left-0 bg-popover border border-border rounded-lg shadow-lg w-48 py-1 text-xs">
            {presets.map((p) => (
              <button key={p.minutes} onClick={() => { onSnooze(p.minutes); setOpen(false); }}
                className="w-full text-right px-3 py-1.5 hover:bg-accent">{p.label}</button>
            ))}
            <div className="border-t my-1" />
            {!customOpen ? (
              <button onClick={() => setCustomOpen(true)} className="w-full text-right px-3 py-1.5 hover:bg-accent">זמן מותאם...</button>
            ) : (
              <div className="px-2 py-1.5 space-y-1.5">
                <div className="flex gap-1">
                  <input type="number" min={1} value={customVal} onChange={(e) => setCustomVal(e.target.value)}
                    placeholder="כמות" className="flex-1 w-0 rounded border border-input px-2 py-1 text-xs" />
                  <select value={customUnit} onChange={(e) => setCustomUnit(e.target.value as any)}
                    className="rounded border border-input px-1 py-1 text-xs">
                    <option value="min">דק'</option>
                    <option value="hour">שעות</option>
                    <option value="day">ימים</option>
                  </select>
                </div>
                <button onClick={submitCustom}
                  className="w-full bg-primary text-primary-foreground rounded py-1 text-xs">דחה</button>
              </div>
            )}
          </div>
        </>
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

function SystemCard({ r, agents, onUpdate, compact, canWrite = true, staleHours = 0, selectMode = false, selected = false, onToggleSelect, draggable = false, onDragStart }: { r: any; agents?: any[]; onUpdate?: (d: any) => void; compact?: boolean; canWrite?: boolean; staleHours?: number; selectMode?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void; draggable?: boolean; onDragStart?: (e: React.DragEvent, id: string) => void }) {
  const navigate = useNavigate();
  const cardCls = statusCardClasses(r.status);
  const openedAt = r.created_at
    ? new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(r.created_at))
    : null;
  const isStale = staleHours > 0
    && !STATUS_HANDLED[r.status]
    && r.updated_at
    && (Date.now() - new Date(r.updated_at).getTime()) > staleHours * 3600_000;
  const handleCardClick = () => {
    if (selectMode && onToggleSelect) { onToggleSelect(r.id); return; }
    navigate({ to: "/systems/$id", params: { id: r.id } });
  };
  return (
    <div onClick={handleCardClick}
      draggable={draggable}
      onDragStart={(e) => { if (onDragStart) onDragStart(e, r.id); }}
      className={`border-2 rounded-xl p-3 cursor-pointer transition ${cardCls} ${isStale ? "ring-2 ring-red-500 animate-pulse-stale" : ""} ${selected ? "ring-2 ring-indigo-500" : ""} ${draggable ? "active:cursor-grabbing" : ""}`}
      title={isStale ? `מערכת ללא טיפול מעל ${staleHours} שעות` : undefined}>
      {selectMode && (
        <div className="flex items-center justify-end mb-1" onClick={(e) => { e.stopPropagation(); onToggleSelect?.(r.id); }}>
          {selected ? <CheckSquare className="h-4 w-4 text-indigo-600" /> : <Square className="h-4 w-4 text-muted-foreground" />}
        </div>
      )}
      {isStale && (
        <div className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-300 rounded px-1.5 py-0.5 inline-block mb-1">
          ⚠ ללא טיפול מעל {staleHours}ש'
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono font-semibold opacity-90">{r.system_code}</span>
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

      {!compact && canWrite && (
        <div className="grid grid-cols-2 gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
          <select value={r.status} onChange={(e) => {
            const newStatus = e.target.value;
            if (newStatus === r.status) return;
            let reason: string | undefined;
            if (!NO_REASON_STATUSES.has(newStatus)) {
              const r2 = window.prompt("סיבת שינוי הסטטוס (חובה):", "");
              if (!r2 || !r2.trim()) { toast.error("יש להזין סיבה"); return; }
              reason = r2.trim();
            }
            onUpdate?.({ id: r.id, status: newStatus, ...(reason ? { reason } : {}) });
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
        {openedAt && (
          <div className="flex items-center gap-1 text-[10px] opacity-70 pt-1 border-t border-current/10">
            <Clock className="h-2.5 w-2.5" />נפתחה: {openedAt}
          </div>
        )}
      </div>

    </div>
  );
}


function CreateModal({ initial, onClose, agents: _agents, onDone }: { initial?: { system_code?: string; name?: string; parent_id?: string }; onClose: () => void; agents: any[]; onDone: () => void }) {
  const [form, setForm] = useState({ system_code: initial?.system_code ?? "", name: initial?.name ?? "", status: "open", assigned_agent_id: "", notes: "", phone: "", caller_phone: "", source: "", email: "" });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [matchedParent, setMatchedParent] = useState<any | null>(null);
  // When a duplicate name is detected the user must choose: create a sub-system
  // under the matched parent, or open a new root with the same name.
  const [createMode, setCreateMode] = useState<"sub" | "root">("sub");
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
        const exact = initial?.parent_id
          ? (rows ?? []).find((r: any) => r.id === initial.parent_id)
          : (rows ?? []).find((r: any) => r.name.trim().toLowerCase() === v.toLowerCase() && !r.parent_system_id);
        setMatchedParent(exact ?? null);
        setCreateMode(initial?.parent_id ? "sub" : "root");
      } catch { /* ignore */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.name, findFn, initial?.parent_id]);

  const willCreateAsSub = !!matchedParent && createMode === "sub";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (willCreateAsSub && matchedParent) {
        await subFn({ data: {
          parent_id: matchedParent.id,
          system_code: form.system_code,
          name: form.name.trim() || undefined,
          status: form.status,
          notes: form.notes,
          phone: buildDialNumber(form.system_code) || form.phone || undefined,
          source: form.source,
          caller_phone: form.caller_phone,
          email: form.email || undefined,
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
          email: form.email || undefined,
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
              <div className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2 space-y-1.5">
                <div className="font-medium">שם זה כבר קיים כאב-מערכת ({matchedParent.system_code}). מה לעשות?</div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createMode" checked={createMode === "sub"} onChange={() => setCreateMode("sub")} />
                  <span>פתח כתת-מערכת תחת "{matchedParent.name}"</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createMode" checked={createMode === "root"} onChange={() => setCreateMode("root")} />
                  <span>פתח אב-מערכת חדשה עם אותו שם</span>
                </label>
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
          <div>
            <label className="text-sm font-medium block mb-1">דוא"ל (אופציונלי)</label>
            <div className="flex gap-1">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="example@gmail.com"
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <button type="button" onClick={() => {
                const v = form.email.trim();
                if (!v || v.includes("@")) return;
                setForm({ ...form, email: v + "@gmail.com" });
              }} className="px-2 py-2 text-xs border border-input rounded-lg hover:bg-accent whitespace-nowrap">
                @gmail.com
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">סטטוס</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
            {willCreateAsSub ? "תת־המערכת תיפתח עם הסטטוס שנבחר כאן, בלי לרשת סטטוס מהאב." : "המערכת תיפתח אוטומטית על שמך כנציג המטפל. ניתן לשייך לנציג אחר לאחר הפתיחה."}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">הערות</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent">ביטול</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {busy ? "..." : willCreateAsSub ? "הוסף תת-מערכת" : "הוסף"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type ExportFormat = "csv" | "pdf" | "xlsx" | "crm";
type RangePreset = "day" | "week" | "month" | "year" | "all" | "custom";

function ExportModal({ allRows, agents, onClose, onExport }: {
  allRows: any[];
  agents: any[];
  onClose: () => void;
  onExport: (format: ExportFormat, fromIso: string | null, toIso: string | null, label: string, statusFilter: string[], agentFilter: string[]) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [preset, setPreset] = useState<RangePreset>("month");
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState<string[]>([]);

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
    const f = fromIso ? new Date(fromIso).getTime() : -Infinity;
    const t = toIso ? new Date(toIso).getTime() : Infinity;
    return allRows.filter((r) => {
      const u = new Date(r.updated_at).getTime();
      if (u < f || u > t) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(r.status)) return false;
      if (agentFilter.length > 0 && !agentFilter.includes(r.assigned_agent_id || "__unassigned")) return false;
      return true;
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
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">סינון לפי סטטוס</label>
              {statusFilter.length > 0 && (
                <button type="button" onClick={() => setStatusFilter([])}
                  className="text-xs text-muted-foreground hover:text-foreground">נקה ({statusFilter.length})</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto p-1 border border-input rounded-lg">
              {STATUS_OPTIONS.map((s) => {
                const active = statusFilter.includes(s.value);
                return (
                  <button key={s.value} type="button"
                    onClick={() => setStatusFilter(active ? statusFilter.filter((v) => v !== s.value) : [...statusFilter, s.value])}
                    className={`text-xs py-1.5 px-2 rounded border text-right truncate ${active ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-accent"}`}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">לא נבחר = כל הסטטוסים</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">סינון לפי נציג מטפל</label>
              {agentFilter.length > 0 && (
                <button type="button" onClick={() => setAgentFilter([])}
                  className="text-xs text-muted-foreground hover:text-foreground">נקה ({agentFilter.length})</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto p-1 border border-input rounded-lg">
              <button type="button"
                onClick={() => setAgentFilter((prev) => prev.includes("__unassigned") ? prev.filter((v) => v !== "__unassigned") : [...prev, "__unassigned"])}
                className={`text-xs py-1.5 px-2 rounded border text-right truncate ${agentFilter.includes("__unassigned") ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-accent"}`}>
                לא משויך
              </button>
              {(agents ?? []).map((a: any) => {
                const active = agentFilter.includes(a.id);
                return (
                  <button key={a.id} type="button"
                    onClick={() => setAgentFilter(active ? agentFilter.filter((v) => v !== a.id) : [...agentFilter, a.id])}
                    className={`text-xs py-1.5 px-2 rounded border text-right truncate ${active ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-accent"}`}>
                    {a.display_name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">לא נבחר = כל הנציגים</p>
          </div>

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
              onExport(format, fromIso, toIso, label, statusFilter, agentFilter);
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

function QuickLookup({ onOpenCreate, canCreate }: { onOpenCreate: (initial?: { system_code?: string; name?: string; parent_id?: string }) => void; canCreate: boolean }) {
  const navigate = useNavigate();
  const codeFn = useServerFn(findSystemByCode);
  const nameFn = useServerFn(findSystemByName);
  const [query, setQuery] = useState("");
  const [codeResult, setCodeResult] = useState<any | null | undefined>(undefined);
  const [nameResults, setNameResults] = useState<any[] | undefined>(undefined);

  // Run both lookups in parallel: code lookup for the numeric portion, name
  // lookup for any text. This keeps a single input box but covers both flows.
  useEffect(() => {
    const v = query.trim();
    if (v.length < 2) { setCodeResult(undefined); setNameResults(undefined); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const isCodeLike = /^\d+$/.test(v);
        const [c, n] = await Promise.all([
          isCodeLike ? codeFn({ data: { code: v } }) : Promise.resolve(undefined),
          nameFn({ data: { name: v } }),
        ]);
        if (cancelled) return;
        setCodeResult(c);
        setNameResults(n ?? []);
      } catch { /* ignore */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, codeFn, nameFn]);

  const v = query.trim();
  const nothingFound = v.length >= 2 && codeResult !== undefined && nameResults !== undefined
    && !codeResult && (nameResults?.length ?? 0) === 0;
  const exactNameMatch = nameResults?.find((r: any) => r.name.trim().toLowerCase() === v.toLowerCase() && !r.parent_system_id);

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Search className="h-4 w-4 text-indigo-600" />
        <h2 className="text-sm font-semibold">בדיקה מהירה</h2>
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="הזן מספר מערכת או שם מערכת..."
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />

      {v.length >= 2 && codeResult === undefined && nameResults === undefined && (
        <div className="mt-2 text-xs text-muted-foreground">מחפש...</div>
      )}

      {codeResult && (
        <button onClick={() => navigate({ to: "/systems/$id", params: { id: codeResult.id } })}
          className={`mt-2 w-full text-right border-2 rounded-lg p-2.5 transition ${statusCardClasses(codeResult.status)}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-mono opacity-80">{codeResult.system_code}</div>
              <div className="text-sm font-semibold truncate">{codeResult.name}</div>
            </div>
            <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium shrink-0 ${toneClasses(STATUS_TONE[codeResult.status as SystemStatus])}`}>
              {STATUS_LABEL[codeResult.status as SystemStatus]}
            </span>
          </div>
          <div className="text-[11px] mt-1 opacity-75">לחץ למעבר למערכת</div>
        </button>
      )}

      {nameResults && nameResults.length > 0 && (
        <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto">
          {nameResults.map((r: any) => (
            <button key={r.id} onClick={() => navigate({ to: "/systems/$id", params: { id: r.id } })}
              className="w-full text-right border border-border rounded-lg p-2 hover:bg-accent transition flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-muted-foreground">{r.system_code}</div>
                <div className="text-sm font-medium truncate">{r.name}</div>
              </div>
              {r.parent_system_id && (
                <CornerUpRight className="h-3 w-3 text-amber-600 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Choice when typed name matches an existing root */}
      {canCreate && exactNameMatch && (
        <div className="mt-2 border-2 border-amber-300 bg-amber-50 rounded-lg p-2.5 space-y-2">
          <div className="text-sm text-amber-900 font-medium">השם "{exactNameMatch.name}" כבר קיים. מה לפתוח?</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onOpenCreate({ name: v })}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90">
              <Plus className="h-3 w-3" />פתח אב-מערכת חדשה
            </button>
            <button onClick={() => onOpenCreate({ name: v, parent_id: exactNameMatch.id })}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-amber-400 text-amber-900 rounded-md text-xs font-medium hover:bg-amber-100">
              <CornerUpRight className="h-3 w-3" />פתח תת-מערכת תחת הקיימת
            </button>
          </div>
        </div>
      )}

      {nothingFound && (
        <div className="mt-2 border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-lg p-2.5">
          <div className="text-sm text-emerald-900 font-medium">לא נמצאה מערכת תואמת</div>
          {canCreate ? (
            <button onClick={() => onOpenCreate(/^\d+$/.test(v) ? { system_code: v } : { name: v })}
              className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90">
              <Plus className="h-3 w-3" />פתח מערכת חדשה
            </button>
          ) : (
            <div className="text-xs text-emerald-800 mt-1">פנה למנהל לפתיחת מערכת חדשה</div>
          )}
        </div>
      )}
    </div>
  );
}



type ImportConflict = {
  row: number;
  name: string;
  system_code: string;
  candidates: Array<{ id: string; system_code: string; name: string }>;
};
type ImportResult = {
  createdCount: number;
  errors: { row: number; reason: string }[];
  incompleteRows: number[];
  conflicts?: ImportConflict[];
};

function ImportModal({ onClose, onImport, agentNames = [] }: {
  onClose: () => void;
  onImport: (rows: Array<Record<string, any>>) => Promise<ImportResult>;
  agentNames?: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Cache of the originally uploaded rows so we can re-submit just the
  // conflicted rows once the user picks a parent/sub decision per row.
  const [pendingRows, setPendingRows] = useState<Array<Record<string, any>>>([]);
  // Per-conflict decision: "root" or { parentId } for sub.
  const [decisions, setDecisions] = useState<Record<number, { relation: "root" } | { relation: "sub"; parentId: string }>>({});

  const HEADERS = ["מספר מערכת", "שם מערכת", "סטטוס", "טלפון", "טלפון פונה", "מקור", "דוא\"ל", "הערות", "נציג"];


  async function downloadTemplate() {
    const statusLabels = STATUS_OPTIONS.map((s) => s.label);
    const sourceLabels = CALLER_SOURCES.map((s) => s.label);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.views = [{ rightToLeft: true } as any];

    const ws = wb.addWorksheet("מערכות", { views: [{ rightToLeft: true }] });
    ws.addRow(HEADERS);
    ws.addRow(["12345", "מערכת לדוגמה", statusLabels[0] ?? "פתוח", "", "", sourceLabels[0] ?? "", "", "", ""]);
    ws.columns = HEADERS.map(() => ({ width: 18 }));
    ws.getRow(1).font = { bold: true };

    // Statuses sheet (also used as dropdown source)
    const wsStatuses = wb.addWorksheet("סטטוסים", { views: [{ rightToLeft: true }] });
    wsStatuses.addRow(["סטטוסים"]);
    statusLabels.forEach((l) => wsStatuses.addRow([l]));
    wsStatuses.getColumn(1).width = 26;
    wsStatuses.getRow(1).font = { bold: true };

    // Sources sheet (also used as dropdown source)
    const wsSources = wb.addWorksheet("מקורות", { views: [{ rightToLeft: true }] });
    wsSources.addRow(["מקורות"]);
    sourceLabels.forEach((l) => wsSources.addRow([l]));
    wsSources.getColumn(1).width = 26;
    wsSources.getRow(1).font = { bold: true };

    // Agents sheet (also used as dropdown source)
    const wsAgents = wb.addWorksheet("נציגים", { views: [{ rightToLeft: true }] });
    wsAgents.addRow(["נציגים"]);
    agentNames.forEach((l) => wsAgents.addRow([l]));
    wsAgents.getColumn(1).width = 26;
    wsAgents.getRow(1).font = { bold: true };

    // Data validation: dropdown on column C (status), rows 2..1000
    const statusRange = `'סטטוסים'!$A$2:$A$${statusLabels.length + 1}`;
    for (let r = 2; r <= 1000; r++) {
      ws.getCell(`C${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [statusRange],
        showErrorMessage: true,
        errorTitle: "סטטוס לא תקין",
        error: "יש לבחור מהרשימה",
      } as any;
    }

    // Data validation: dropdown on column F (source), rows 2..1000
    const sourceRange = `'מקורות'!$A$2:$A$${sourceLabels.length + 1}`;
    for (let r = 2; r <= 1000; r++) {
      ws.getCell(`F${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [sourceRange],
        showErrorMessage: true,
        errorTitle: "מקור לא תקין",
        error: "יש לבחור מהרשימה",
      } as any;
    }

    // Data validation: dropdown on column I (agent), rows 2..1000
    if (agentNames.length > 0) {
      const agentRange = `'נציגים'!$A$2:$A$${agentNames.length + 1}`;
      for (let r = 2; r <= 1000; r++) {
        ws.getCell(`I${r}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [agentRange],
          showErrorMessage: true,
          errorTitle: "נציג לא תקין",
          error: "יש לבחור מהרשימה",
        } as any;
      }
    }

    const buf = await wb.xlsx.writeBuffer();

    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "תבנית_ייבוא_מערכות.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }


  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    setDecisions({});
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: Array<Record<string, any>> = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rows.length) { toast.error("הקובץ ריק"); setBusy(false); return; }
      setPendingRows(rows);
      const res = await onImport(rows);
      setResult(res);
    } catch (e: any) {
      toast.error(e?.message || "שגיאה בקריאת הקובץ");
    } finally {
      setBusy(false);
    }
  }

  // Re-submit the conflicted rows with the user's per-row decision attached.
  async function applyDecisions() {
    if (!result?.conflicts?.length) return;
    setBusy(true);
    try {
      const rowsToSend = result.conflicts.map((c) => {
        const decision = decisions[c.row];
        if (!decision) return null;
        const original = pendingRows[c.row - 2]; // row 1 is header
        if (!original) return null;
        return {
          ...original,
          __relation: decision.relation,
          __parent_id: decision.relation === "sub" ? decision.parentId : undefined,
        };
      }).filter(Boolean) as Array<Record<string, any>>;
      if (!rowsToSend.length) {
        toast.error("יש לבחור הכרעה לפחות לשורה אחת");
        setBusy(false);
        return;
      }
      const res = await onImport(rowsToSend);
      // Merge with prior result so the user sees cumulative counts.
      setResult((prev) => ({
        createdCount: (prev?.createdCount ?? 0) + res.createdCount,
        errors: [...(prev?.errors ?? []), ...res.errors],
        incompleteRows: [...(prev?.incompleteRows ?? []), ...res.incompleteRows],
        conflicts: res.conflicts ?? [],
      }));
      setDecisions({});
    } catch (e: any) {
      toast.error(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-2xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">ייבוא מערכות מאקסל</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded"><X className="h-4 w-4" /></button>
        </div>

        <div className="text-sm text-muted-foreground mb-3">
          העמודות הנדרשות בכותרת הקובץ:
          <div className="mt-2 flex flex-wrap gap-1">
            {HEADERS.map((h) => (
              <span key={h} className={`px-2 py-0.5 rounded text-xs border ${["מספר מערכת","שם מערכת","סטטוס"].includes(h) ? "bg-amber-50 border-amber-300 text-amber-900 font-medium" : "bg-muted/50 border-border"}`}>
                {h}{["מספר מערכת","שם מערכת","סטטוס"].includes(h) ? " *" : ""}
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs">* שדות חובה. בשורות עם חסרי שדות אופציונליים — תיפתח מערכת ויירשם בהערות שחסרים פרטים.</div>
        </div>

        <div className="flex flex-col gap-2">
          <button onClick={downloadTemplate} className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
            <Download className="h-4 w-4" />הורד תבנית אקסל
          </button>
          <label className={`flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium cursor-pointer hover:bg-primary/90 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
            <Upload className="h-4 w-4" />{busy ? "מייבא..." : "העלה קובץ אקסל"}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }} />
          </label>
        </div>

        {result && (
          <div className="mt-4 space-y-2 text-sm">
            {result.createdCount > 0 && (
              <div className="rounded-md border border-green-300 bg-green-50 text-green-900 p-2">
                נוצרו בהצלחה {result.createdCount} מערכות
                {result.incompleteRows.length > 0 && <span> ({result.incompleteRows.length} עם פרטים חסרים — סומנו בהערות)</span>}
              </div>
            )}

            {result.conflicts && result.conflicts.length > 0 && (
              <div className="rounded-md border-2 border-amber-400 bg-amber-50 text-amber-900 p-3">
                <div className="font-bold mb-2">
                  התגלו {result.conflicts.length} שורות עם שם זהה למערכת קיימת — נדרשת הכרעה:
                </div>
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {result.conflicts.map((c) => {
                    const decision = decisions[c.row];
                    return (
                      <div key={c.row} className="border border-amber-300 rounded-md p-2 bg-white">
                        <div className="text-xs text-muted-foreground mb-1">שורה {c.row}</div>
                        <div className="text-sm font-medium mb-2">
                          {c.system_code} · {c.name}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="radio"
                              name={`r-${c.row}`}
                              checked={decision?.relation === "root"}
                              onChange={() => setDecisions((d) => ({ ...d, [c.row]: { relation: "root" } }))}
                            />
                            פתח כמערכת ראשית חדשה (אב נפרד)
                          </label>
                          {c.candidates.length > 0 && (
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="radio"
                                name={`r-${c.row}`}
                                checked={decision?.relation === "sub"}
                                onChange={() => setDecisions((d) => ({
                                  ...d,
                                  [c.row]: { relation: "sub", parentId: c.candidates[0].id },
                                }))}
                              />
                              צרף כתת-מערכת תחת:
                              <select
                                disabled={decision?.relation !== "sub"}
                                value={decision?.relation === "sub" ? decision.parentId : ""}
                                onChange={(e) => setDecisions((d) => ({
                                  ...d,
                                  [c.row]: { relation: "sub", parentId: e.target.value },
                                }))}
                                className="text-xs rounded border border-input bg-background px-1 py-0.5"
                              >
                                {c.candidates.map((cand) => (
                                  <option key={cand.id} value={cand.id}>
                                    {cand.system_code} · {cand.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={applyDecisions}
                  disabled={busy || Object.keys(decisions).length === 0}
                  className="mt-3 px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
                >
                  המשך עם ההכרעות ({Object.keys(decisions).length})
                </button>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="rounded-md border border-red-300 bg-red-50 text-red-900 p-2">
                <div className="font-medium mb-1">{result.errors.length} שורות לא יובאו:</div>
                <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>שורה {e.row}: {e.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ImportExportMenu({ canExport, onExport, onImport }: { canExport: boolean; onExport: () => void; onImport: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent"
      >
        <Upload className="h-4 w-4" />ייבוא / ייצוא
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 min-w-[180px] bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          <button
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); onImport(); }}
            className="flex items-center gap-2 w-full text-right px-3 py-2 text-sm hover:bg-accent"
          >
            <Upload className="h-4 w-4" />ייבוא מאקסל
          </button>
          {canExport && (
            <button
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onExport(); }}
              className="flex items-center gap-2 w-full text-right px-3 py-2 text-sm hover:bg-accent border-t border-border"
            >
              <Download className="h-4 w-4" />ייצוא לפי תאריכים
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KanbanBoard({ rows, agents, canWrite, staleHours, onUpdate, onDropStatus, selectMode, selectedIds, onToggleSelect }: {
  rows: any[];
  agents: any[];
  canWrite: boolean;
  staleHours: number;
  onUpdate: (d: any) => void;
  onDropStatus: (id: string, newStatus: string) => void;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const opt of STATUS_OPTIONS) map[opt.value] = [];
    for (const r of rows) {
      if (!map[r.status]) map[r.status] = [];
      map[r.status].push(r);
    }
    return map;
  }, [rows]);

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDrop(e: React.DragEvent, statusKey: string) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    if (id) onDropStatus(id, statusKey);
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-max">
        {STATUS_OPTIONS.map((opt) => {
          const items = grouped[opt.value] ?? [];
          const isOver = dragOver === opt.value;
          return (
            <div key={opt.value}
              onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDragOver(opt.value); } }}
              onDragLeave={() => setDragOver((v) => (v === opt.value ? null : v))}
              onDrop={(e) => canWrite && onDrop(e, opt.value)}
              className={`w-72 shrink-0 rounded-xl border-2 p-2 transition ${statusCardClasses(opt.value)} ${isOver ? "ring-2 ring-indigo-500 ring-offset-2" : ""}`}>
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="text-sm font-semibold truncate">{opt.label}</div>
                <span className="text-[11px] bg-white/70 border border-border rounded-full px-2 py-0.5">{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {items.length === 0 && (
                  <div className="text-[11px] text-center text-muted-foreground py-6 border-2 border-dashed border-border/60 rounded-lg">
                    גרור לכאן
                  </div>
                )}
                {items.map((r: any) => (
                  <SystemCard key={r.id} r={r} agents={agents} canWrite={canWrite} staleHours={staleHours}
                    onUpdate={onUpdate} compact
                    selectMode={selectMode} selected={selectedIds.has(r.id)} onToggleSelect={onToggleSelect}
                    draggable={canWrite && !selectMode} onDragStart={onDragStart} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

