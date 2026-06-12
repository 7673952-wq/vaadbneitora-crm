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
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
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

  function exportCsv() {
    const rows = filtered;
    if (!rows.length) { toast.info("אין נתונים לייצוא"); return; }
    const header = ["מזהה מערכת", "שם", "סטטוס", "נציג מטפל", "טלפון", "תת-מערכת של", "הערות", "עדכון אחרון"];
    const data = rows.map((r: any) => [
      r.system_code, r.name, STATUS_LABEL[r.status as SystemStatus] || r.status,
      r.agent?.display_name || "", r.phone || "",
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
    a.download = `systems_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const baseRows = systems ?? [];
    const dayStart = new Date(pdfDate + "T00:00:00");
    const dayEnd = new Date(pdfDate + "T23:59:59.999");
    const rows = baseRows.filter((r: any) => {
      if (status && r.status !== status) return false;
      const u = new Date(r.updated_at);
      return u >= dayStart && u <= dayEnd;
    });
    if (!rows.length) { toast.info("אין נתונים לייצוא בתאריך זה"); return; }
    const dateLabel = dayStart.toLocaleDateString("he-IL");
    const statusLabel = status ? (STATUS_LABEL[status as SystemStatus] || status) : "כל הסטטוסים";
    const tableRows = rows.map((r: any) => `
      <tr>
        <td>${r.system_code ?? ""}</td>
        <td>${r.name ?? ""}</td>
        <td>${STATUS_LABEL[r.status as SystemStatus] || r.status}</td>
        <td>${r.agent?.display_name ?? "—"}</td>
        <td>${(r.notes ?? "").replace(/</g, "&lt;")}</td>
        <td>${new Date(r.updated_at).toLocaleString("he-IL")}</td>
      </tr>`).join("");
    const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8" />
      <title>דוח מערכות ${dateLabel}</title>
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
      <h1>דוח מערכות יומי</h1>
      <div class="meta">תאריך: ${dateLabel} · סטטוס: ${statusLabel} · סה"כ: ${rows.length}</div>
      <table>
        <thead><tr><th>מזהה</th><th>שם מערכת</th><th>סטטוס</th><th>נציג מטפל</th><th>הערות</th><th>עדכון אחרון</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="footer">הופק ב-${new Date().toLocaleString("he-IL")}</div>
      <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("חסום על ידי דפדפן — אפשר חלונות קופצים"); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function exportCrmXlsx() {
    const rows = filtered.filter((r: any) => r.status === "to_block" || r.status === "to_open");
    if (!rows.length) { toast.info("אין מערכות בסטטוס לחסום/לפתוח לייצוא"); return; }
    const data = rows.map((r: any) => ({
      phone_number: buildDialNumber(r.system_code),
      caller_id: buildDialNumber(r.caller_phone || r.phone || r.system_code),
      active: 1,
      call_type: "ALL",
      status: r.status === "to_block" ? "BLOCKED" : "OPEN",
    }));
    const ws = XLSX.utils.json_to_sheet(data, { header: ["phone_number", "caller_id", "active", "call_type", "status"] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CRM");
    XLSX.writeFile(wb, `crm_block_open_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function exportMenu() {
    const choice = window.prompt("בחר ייצוא: 1=CSV, 2=PDF, 3=Excel CRM", "1");
    if (choice === "1") exportCsv();
    else if (choice === "2") exportPdf();
    else if (choice === "3") exportCrmXlsx();
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
          <button onClick={exportMenu} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
            <Download className="h-4 w-4" />ייצוא
          </button>
          <div className="flex items-center gap-1 border border-border rounded-lg px-2 py-1 text-sm">
            <input type="date" value={pdfDate} onChange={(e) => setPdfDate(e.target.value)}
              className="bg-transparent text-sm outline-none px-1" aria-label="תאריך דוח PDF" />
            <button onClick={exportPdf} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium hover:bg-accent">
              <Download className="h-3.5 w-3.5" />ייצוא PDF
            </button>
          </div>
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

      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">התפלגות סטטוסים</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={46} outerRadius={86} paddingAngle={2}>
                  {chartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
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


      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] opacity-80">
        <span className="truncate">{r.agent?.display_name ?? "לא משויך"}</span>
        {buildDialNumber(r.system_code) && (
          <a href={`tel:${buildDialNumber(r.system_code)}`} onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">
            <Phone className="h-2.5 w-2.5" />ID
          </a>
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
              <div>
                <label className="text-sm font-medium block mb-1">נציג מטפל</label>
                <select value={form.assigned_agent_id} onChange={(e) => setForm({ ...form, assigned_agent_id: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value="">— לא משויך —</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
                </select>
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

