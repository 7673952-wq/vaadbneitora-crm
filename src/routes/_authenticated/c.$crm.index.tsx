import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Search, Phone, Mail, X } from "lucide-react";
import { useMyCrms } from "@/lib/use-crms";
import { listRecords, createRecord, listFieldDefs } from "@/lib/crm-records.functions";
import { getAuthHeaders } from "@/lib/auth-headers";

export const Route = createFileRoute("/_authenticated/c/$crm/")({
  component: CrmHome,
});

export const GENERIC_STATUSES: { key: string; label: string; tone: string }[] = [
  { key: "open", label: "פתוח", tone: "#2563eb" },
  { key: "in_progress", label: "בטיפול", tone: "#b45309" },
  { key: "waiting", label: "ממתין", tone: "#7c3aed" },
  { key: "closed", label: "סגור", tone: "#059669" },
];

function statusOf(key: string) {
  return GENERIC_STATUSES.find((s) => s.key === key) ?? { key, label: key, tone: "#64748b" };
}

function CrmHome() {
  const { crm } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: crms } = useMyCrms();
  const current = crms?.find((c) => c.key === crm);
  const canWrite = current?.myRole && current.myRole !== "viewer";

  const listFn = useServerFn(listRecords);
  const fieldsFn = useServerFn(listFieldDefs);
  const createFn = useServerFn(createRecord);

  const [search, setSearch] = useState("");
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["crm_records", crm],
    queryFn: async () => listFn({ data: { crmKey: crm }, headers: await getAuthHeaders() }),
  });
  const { data: fields = [] } = useQuery({
    queryKey: ["crm_field_defs", crm],
    queryFn: async () => fieldsFn({ data: { crmKey: crm }, headers: await getAuthHeaders() }),
  });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    const digits = q.replace(/\D/g, "");
    return records.filter((r) => {
      const hay = [r.recordCode, r.name, statusOf(r.status).label, r.email, r.source, r.notes, JSON.stringify(r.custom)]
        .filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) return true;
      if (digits) return `${r.phone ?? ""}${r.callerPhone ?? ""}`.replace(/\D/g, "").includes(digits);
      return false;
    });
  }, [records, search]);

  async function submit() {
    if (!form.recordCode?.trim()) { toast.error(`נדרש ${current?.idLabel ?? "מזהה"}`); return; }
    setBusy(true);
    try {
      const rec = await createFn({
        data: {
          crmKey: crm,
          recordCode: form.recordCode,
          name: form.name ?? "",
          status: form.status ?? "open",
          phone: form.phone || null,
          callerPhone: form.callerPhone || null,
          email: form.email || null,
          source: form.source || null,
          notes: form.notes || null,
          custom,
        },
        headers: await getAuthHeaders(),
      });
      await qc.invalidateQueries({ queryKey: ["crm_records", crm] });
      toast.success("הפניה נפתחה");
      setOpen(false); setForm({}); setCustom({});
      navigate({ to: "/c/$crm/$id", params: { crm, id: rec.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בפתיחת פניה");
    } finally {
      setBusy(false);
    }
  }

  const idLabel = current?.idLabel ?? "מזהה";

  return (
    <div dir="rtl" className="space-y-4">
      <div
        className="rounded-xl border border-border p-5 flex flex-wrap items-center gap-3"
        style={{ background: `linear-gradient(90deg, ${current?.color ?? "#2563eb"}1a, transparent)` }}
      >
        <div className="flex-1 min-w-[180px]">
          <h1 className="text-xl font-semibold">{current?.name ?? crm}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} פניות</p>
        </div>
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בכל הנתונים..."
            className="w-64 rounded-lg border border-input bg-background pr-8 pl-3 py-1.5 text-sm"
          />
        </div>
        {canWrite && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> פתיחת פניה
          </button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-right font-medium px-3 py-2">{idLabel}</th>
              <th className="text-right font-medium px-3 py-2">שם</th>
              <th className="text-right font-medium px-3 py-2">סטטוס</th>
              <th className="text-right font-medium px-3 py-2">טלפון</th>
              <th className="text-right font-medium px-3 py-2">מייל</th>
              {fields.filter((f) => f.showInTable).map((f) => (
                <th key={f.id} className="text-right font-medium px-3 py-2">{f.label}</th>
              ))}
              <th className="text-right font-medium px-3 py-2">נפתח</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">טוען...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">אין פניות להצגה</td></tr>
            )}
            {filtered.map((r) => {
              const st = statusOf(r.status);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-accent/40 transition">
                  <td className="px-3 py-2 font-medium">
                    <Link to="/c/$crm/$id" params={{ crm, id: r.id }} className="hover:underline">{r.recordCode}</Link>
                  </td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${st.tone}1f`, color: st.tone }}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.phone && (
                      <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:underline">
                        <Phone className="h-3 w-3" />{r.phone}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.email && (
                      <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{r.email}</span>
                    )}
                  </td>
                  {fields.filter((f) => f.showInTable).map((f) => (
                    <td key={f.id} className="px-3 py-2">{String(r.custom?.[f.fieldKey] ?? "")}</td>
                  ))}
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("he-IL")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">פניה חדשה · {current?.name ?? crm}</h2>
              <button onClick={() => !busy && setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={idLabel} required value={form.recordCode ?? ""} onChange={(v) => setForm((f) => ({ ...f, recordCode: v }))} />
              <Field label="שם" value={form.name ?? ""} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              <div>
                <label className="text-xs font-medium block mb-1">סטטוס</label>
                <select
                  value={form.status ?? "open"}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  {GENERIC_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <Field label="טלפון" value={form.phone ?? ""} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              <Field label="מספר פונה" value={form.callerPhone ?? ""} onChange={(v) => setForm((f) => ({ ...f, callerPhone: v }))} />
              <Field label="מייל" value={form.email ?? ""} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
              <Field label="מקור" value={form.source ?? ""} onChange={(v) => setForm((f) => ({ ...f, source: v }))} />
              {fields.map((f) => (
                <div key={f.id} className={f.fieldType === "textarea" ? "col-span-2" : ""}>
                  <label className="text-xs font-medium block mb-1">{f.label}{f.required ? " *" : ""}</label>
                  {f.fieldType === "select" ? (
                    <select
                      value={custom[f.fieldKey] ?? ""}
                      onChange={(e) => setCustom((c) => ({ ...c, [f.fieldKey]: e.target.value }))}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.fieldType === "textarea" ? (
                    <textarea
                      rows={3}
                      value={custom[f.fieldKey] ?? ""}
                      onChange={(e) => setCustom((c) => ({ ...c, [f.fieldKey]: e.target.value }))}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  ) : (
                    <input
                      type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : "text"}
                      value={custom[f.fieldKey] ?? ""}
                      onChange={(e) => setCustom((c) => ({ ...c, [f.fieldKey]: e.target.value }))}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  )}
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-xs font-medium block mb-1">הערות</label>
                <textarea
                  rows={3}
                  value={form.notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <button onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
                {busy ? "פותח..." : "פתח פניה"}
              </button>
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm">ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1">{label}{required ? " *" : ""}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
    </div>
  );
}
