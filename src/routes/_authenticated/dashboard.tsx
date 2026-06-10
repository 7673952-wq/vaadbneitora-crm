import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listSystems, listAgents, createSystem, updateSystem } from "@/lib/systems.functions";
import { getMyRole } from "@/lib/admin.functions";
import { STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, toneClasses, type SystemStatus } from "@/lib/status";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Download, Search, Filter, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "דשבורד | CRM" }] }),
  component: Dashboard,
});

type Period = "" | "day" | "week" | "month" | "year";

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listSystems);
  const agentsFn = useServerFn(listAgents);
  const meFn = useServerFn(getMyRole);
  const createFn = useServerFn(createSystem);
  const updateFn = useServerFn(updateSystem);

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

  const filtered = useMemo(() => {
    if (!systems) return [];
    if (!search.trim()) return systems;
    const s = search.trim().toLowerCase();
    return systems.filter((r: any) => {
      const nameMatch = r.name?.toLowerCase().includes(s);
      const codeMatch = r.system_code?.toLowerCase().includes(s);
      const agentMatch = r.agent?.display_name?.toLowerCase().includes(s);
      const statusMatch = (STATUS_LABEL[r.status as SystemStatus] || "").includes(s);
      return nameMatch || codeMatch || agentMatch || statusMatch;
    });
  }, [systems, search]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    (systems ?? []).forEach((s: any) => { counts[s.status] = (counts[s.status] || 0) + 1; });
    return counts;
  }, [systems]);

  const updateMutation = useMutation({
    mutationFn: updateFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["systems"] }); toast.success("עודכן"); },
    onError: (e: any) => toast.error(e.message),
  });

  function exportCsv() {
    const rows = filtered;
    if (!rows.length) { toast.info("אין נתונים לייצוא"); return; }
    const header = ["מזהה מערכת", "שם", "סטטוס", "נציג מטפל", "הערות", "עדכון אחרון"];
    const data = rows.map((r: any) => [
      r.system_code, r.name, STATUS_LABEL[r.status as SystemStatus] || r.status,
      r.agent?.display_name || "", (r.notes || "").replace(/\n/g, " "), new Date(r.updated_at).toLocaleString("he-IL"),
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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">דשבורד מערכות</h1>
          <p className="text-muted-foreground text-sm mt-1">סה"כ {systems?.length ?? 0} מערכות · מציג {filtered.length}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
            <Download className="h-4 w-4" />ייצוא CSV
          </button>
          <div className="flex items-center gap-1 border border-border rounded-lg px-2 py-1 text-sm">
            <input
              type="date"
              value={pdfDate}
              onChange={(e) => setPdfDate(e.target.value)}
              className="bg-transparent text-sm outline-none px-1"
              aria-label="תאריך דוח PDF"
            />
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {STATUS_OPTIONS.slice(0, 6).map((s) => (
          <div key={s.value} className="bg-card border border-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-bold mt-1">{stats[s.value] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />סינון:
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם או מזהה..."
            className="pr-9 pl-3 py-2 text-sm rounded-lg border border-input bg-background w-64 focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הסטטוסים</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-input bg-background">
          <option value="">כל הנציגים</option>
          <option value="">— לא משויך —</option>
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

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr className="text-right">
                <th className="px-4 py-3 font-medium text-muted-foreground">מזהה</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">שם מערכת</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">נציג מטפל</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">עדכון אחרון</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">טוען...</td></tr>}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">לא נמצאו מערכות</td></tr>}
              {filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent/30 transition cursor-pointer"
                  onClick={() => navigate({ to: "/systems/$id", params: { id: r.id } })}>
                  <td className="px-4 py-3 font-mono text-xs">{r.system_code}</td>
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select value={r.status} onChange={(e) => updateMutation.mutate({ data: { id: r.id, status: e.target.value } })}
                      className={`text-xs rounded-full px-2.5 py-1 font-medium ${toneClasses(STATUS_TONE[r.status as SystemStatus])} border-0 outline-none cursor-pointer`}>
                      {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select value={r.assigned_agent_id || ""} onChange={(e) => updateMutation.mutate({ data: { id: r.id, assigned_agent_id: e.target.value || null } })}
                      className="text-xs rounded-md border border-input bg-background px-2 py-1">
                      <option value="">— לא משויך —</option>
                      {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(r.updated_at).toLocaleString("he-IL")}</td>
                  <td className="px-4 py-3">
                    <Link to="/systems/$id" params={{ id: r.id }} className="text-primary hover:underline text-xs">פתח</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && me?.isAdmin && (
        <CreateModal onClose={() => setShowCreate(false)} agents={agents ?? []} onCreate={(d) => {
          createFn({ data: d }).then(() => {
            qc.invalidateQueries({ queryKey: ["systems"] });
            toast.success("נוסף בהצלחה");
            setShowCreate(false);
          }).catch((e) => toast.error(e.message));
        }} />
      )}
    </div>
  );
}

function CreateModal({ onClose, agents, onCreate }: { onClose: () => void; agents: any[]; onCreate: (d: any) => void }) {
  const [form, setForm] = useState({ system_code: "", name: "", status: "open", assigned_agent_id: "", notes: "" });
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">הוספת מערכת חדשה</h2>
        <form onSubmit={(e) => { e.preventDefault(); onCreate({ ...form, assigned_agent_id: form.assigned_agent_id || null }); }} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">מזהה מערכת</label>
            <input required value={form.system_code} onChange={(e) => setForm({ ...form, system_code: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">שם המערכת</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
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
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent">ביטול</button>
            <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">הוסף</button>
          </div>
        </form>
      </div>
    </div>
  );
}
