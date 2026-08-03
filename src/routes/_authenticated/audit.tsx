import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listAuditLog, listAuditActors, revertAuditEntry, isRevertibleEntry } from "@/lib/audit.functions";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { Download, Search, ArrowRight, Undo2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "יומן בקרה | CRM" }] }),
  component: AuditPage,
});

const ACTION_LABELS: Record<string, string> = {
  created: "יצירה",
  updated: "עדכון",
  deleted: "מחיקה",
  restored: "שחזור",
  reverted: "ביטול פעולה",
  role_granted: "הענקת הרשאה",
  role_revoked: "הסרת הרשאה",
  backup_restore_started: "התחלת שחזור גיבוי",
  backup_restore_completed: "שחזור גיבוי הושלם",
  backup_restore_failed: "שחזור גיבוי נכשל",
};


const FIELD_LABELS: Record<string, string> = {
  status: "סטטוס",
  assigned_agent_id: "נציג מטפל",
  name: "שם מערכת",
  notes: "הערות",
  phone: "טלפון",
  caller_phone: "טלפון מתקשר",
  source: "מקור",
  reminder_at: "תזכורת",
  parent_system_id: "מערכת אב",
  user_roles: "הרשאות משתמש",
  "mode:replace": "מצב: החלפה",
  "mode:merge": "מצב: מיזוג",
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString("he-IL"); } catch { return iso; }
}

function downloadCSV(rows: any[]) {
  const headers = ["תאריך", "משתמש", "פעולה", "שדה", "ערך קודם", "ערך חדש", "סיבה", "מערכת"];
  const escape = (v: any) => {
    const raw = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const data = rows.map((r) => [
    fmtDate(r.created_at), r.actor_name, ACTION_LABELS[r.action] ?? r.action,
    FIELD_LABELS[r.field] ?? r.field ?? "", r.old_display ?? "", r.new_display ?? "",
    r.reason ?? "", r.system ? `${r.system.system_code} / ${r.system.name}` : "",
  ]);
  const csv = "\uFEFF" + [headers, ...data].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function AuditPage() {
  const navigate = useNavigate();
  const meFn = useServerFn(getMyRole);
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["my-role"], queryFn: async () => meFn({ headers: await getAuthHeaders() }) });
  useEffect(() => {
    if (!meLoading && me && !me.isSuperAdmin) navigate({ to: "/dashboard", replace: true });
  }, [me, meLoading, navigate]);

  const listFn = useServerFn(listAuditLog);
  const actorsFn = useServerFn(listAuditActors);

  const [actorId, setActorId] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [appliedSearch, setAppliedSearch] = useState<string>("");

  const filters = useMemo(() => ({
    actor_id: actorId || null,
    action: action || null,
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(to).toISOString() : null,
    search: appliedSearch || null,
    limit: 1000,
  }), [actorId, action, from, to, appliedSearch]);

  const { data: actors } = useQuery({ queryKey: ["audit-actors"], queryFn: async () => actorsFn({ headers: await getAuthHeaders() }), enabled: !!me?.isSuperAdmin });
  const { data: rows, isLoading } = useQuery({
    queryKey: ["audit-log", filters],
    queryFn: async () => listFn({ data: filters, headers: await getAuthHeaders() }),
    enabled: !!me?.isSuperAdmin,
  });

  const list = rows ?? [];

  const qc = useQueryClient();
  const revertFn = useServerFn(revertAuditEntry);
  const revertMut = useMutation({
    mutationFn: async (id: string) => revertFn({ data: { id }, headers: await getAuthHeaders() }),
    onSuccess: () => {
      toast.success("הפעולה בוטלה");
      qc.invalidateQueries({ queryKey: ["audit-log"] });
      qc.invalidateQueries({ queryKey: ["systems"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בביטול הפעולה"),
  });


  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="p-2 rounded-lg hover:bg-accent" title="חזרה">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">יומן בקרה</h1>
            <p className="text-sm text-muted-foreground">תיעוד מלא של כל הפעולות במערכת</p>
          </div>
        </div>
        <button
          onClick={() => downloadCSV(list)}
          className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent"
        >
          <Download className="h-4 w-4" /> ייצוא CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 border border-border rounded-lg p-3 bg-card">
        <div>
          <label className="text-xs text-muted-foreground">משתמש</label>
          <select value={actorId} onChange={(e) => setActorId(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background">
            <option value="">כל המשתמשים</option>
            {(actors ?? []).map((a: any) => (
              <option key={a.id} value={a.id}>{a.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">פעולה</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background">
            <option value="">כל הפעולות</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">מתאריך</label>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">עד תאריך</label>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">חיפוש חופשי</label>
          <form onSubmit={(e) => { e.preventDefault(); setAppliedSearch(search); }} className="flex gap-1">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="שם, ערך, סיבה..."
              className="flex-1 border border-border rounded-md px-2 py-1.5 text-sm bg-background" />
            <button type="submit" className="px-2 py-1.5 border border-border rounded-md hover:bg-accent">
              <Search className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {isLoading ? "טוען..." : `מציג ${list.length} רשומות${list.length >= 1000 ? " (הצגה מוגבלת ל-1000, צמצם פילטרים)" : ""}`}
      </div>

      <div className="border border-border rounded-lg overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="text-right p-2 whitespace-nowrap">תאריך ושעה</th>
              <th className="text-right p-2 whitespace-nowrap">משתמש</th>
              <th className="text-right p-2 whitespace-nowrap">פעולה</th>
              <th className="text-right p-2 whitespace-nowrap">שדה</th>
              <th className="text-right p-2">השוואה לפני / אחרי</th>
              <th className="text-right p-2">סיבה</th>
              <th className="text-right p-2 whitespace-nowrap">מערכת</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r: any) => {
              const hasOld = r.old_display !== null && r.old_display !== undefined && r.old_display !== "";
              const hasNew = r.new_display !== null && r.new_display !== undefined && r.new_display !== "";
              return (
                <tr key={r.id} className="border-t border-border align-top hover:bg-accent/30">
                  <td className="p-2 whitespace-nowrap text-xs">{fmtDate(r.created_at)}</td>
                  <td className="p-2 whitespace-nowrap">{r.actor_name}</td>
                  <td className="p-2 whitespace-nowrap">{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td className="p-2 whitespace-nowrap text-muted-foreground">{FIELD_LABELS[r.field] ?? r.field ?? "—"}</td>
                  <td className="p-2 min-w-[280px] max-w-[480px]">
                    {!hasOld && !hasNew ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs">
                          <div className="text-[10px] font-semibold text-red-700 mb-0.5">לפני</div>
                          <div className="text-red-900 line-through whitespace-pre-wrap break-words">
                            {hasOld ? String(r.old_display) : <span className="opacity-50 no-underline">—</span>}
                          </div>
                        </div>
                        <div className="flex items-center text-muted-foreground text-sm">→</div>
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs">
                          <div className="text-[10px] font-semibold text-emerald-700 mb-0.5">אחרי</div>
                          <div className="text-emerald-900 font-medium whitespace-pre-wrap break-words">
                            {hasNew ? String(r.new_display) : <span className="opacity-50 font-normal">—</span>}
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="p-2 max-w-[180px] break-words text-muted-foreground">{r.reason ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap">
                    {r.system ? (
                      <Link to="/systems/$id" params={{ id: r.system_id }} className="text-primary hover:underline">
                        {r.system.system_code}
                      </Link>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
            {!isLoading && list.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">לא נמצאו רשומות</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
