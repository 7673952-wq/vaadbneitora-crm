import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, Phone, Save, Trash2 } from "lucide-react";
import { useMyCrms } from "@/lib/use-crms";
import { getRecord, updateRecord, addRecordNote, deleteRecord, listFieldDefs } from "@/lib/crm-records.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { GENERIC_STATUSES } from "./c.$crm.index";

export const Route = createFileRoute("/_authenticated/c/$crm/$id")({
  component: RecordDetail,
});

function RecordDetail() {
  const { crm, id } = Route.useParams();
  const qc = useQueryClient();
  const { data: crms } = useMyCrms();
  const current = crms?.find((c) => c.key === crm);
  const canWrite = current?.myRole && current.myRole !== "viewer";

  const getFn = useServerFn(getRecord);
  const updateFn = useServerFn(updateRecord);
  const noteFn = useServerFn(addRecordNote);
  const delFn = useServerFn(deleteRecord);
  const fieldsFn = useServerFn(listFieldDefs);

  const { data, isLoading } = useQuery({
    queryKey: ["crm_record", id],
    queryFn: async () => getFn({ data: { id }, headers: await getAuthHeaders() }),
  });
  const { data: fields = [] } = useQuery({
    queryKey: ["crm_field_defs", crm],
    queryFn: async () => fieldsFn({ data: { crmKey: crm }, headers: await getAuthHeaders() }),
  });

  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  async function patch(p: Record<string, any>) {
    setBusy(true);
    try {
      await updateFn({ data: { id, patch: p }, headers: await getAuthHeaders() });
      await qc.invalidateQueries({ queryKey: ["crm_record", id] });
      await qc.invalidateQueries({ queryKey: ["crm_records", crm] });
      toast.success("נשמר");
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בשמירה");
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    try {
      await noteFn({ data: { recordId: id, crmKey: crm, body: noteText }, headers: await getAuthHeaders() });
      setNoteText("");
      await qc.invalidateQueries({ queryKey: ["crm_record", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בהוספת הערה");
    }
  }

  if (isLoading || !data) return <div dir="rtl" className="text-sm text-muted-foreground">טוען...</div>;
  const r = data.record;
  const st = GENERIC_STATUSES.find((s) => s.key === r.status) ?? { label: r.status, tone: "#64748b" };

  return (
    <div dir="rtl" className="space-y-4">
      <div className="rounded-xl border border-border p-4 flex flex-wrap items-center gap-3"
        style={{ background: `linear-gradient(90deg, ${st.tone}22, transparent)` }}>
        <Link to="/c/$crm" params={{ crm }} className="text-muted-foreground hover:text-foreground"><ArrowRight className="h-4 w-4" /></Link>
        <div className="flex-1 min-w-[160px]">
          <div className="text-xs text-muted-foreground">{current?.name} · {current?.idLabel}</div>
          <h1 className="text-lg font-semibold">{r.recordCode} {r.name && <span className="text-muted-foreground font-normal">· {r.name}</span>}</h1>
        </div>
        <select
          value={r.status}
          disabled={!canWrite || busy}
          onChange={(e) => patch({ status: e.target.value })}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
        >
          {GENERIC_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {r.phone && (
          <a href={`tel:${r.phone}`} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
            <Phone className="h-3.5 w-3.5" /> חייג
          </a>
        )}
        {current?.myRole === "admin" || current?.myRole === "super_admin" ? (
          <button
            onClick={async () => {
              if (!confirm("למחוק את הפניה?")) return;
              await delFn({ data: { id }, headers: await getAuthHeaders() });
              await qc.invalidateQueries({ queryKey: ["crm_records", crm] });
              window.history.back();
            }}
            className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold mb-3">פרטים</h2>
            <div className="grid grid-cols-2 gap-3">
              <Editable label="שם" value={r.name} disabled={!canWrite} onSave={(v) => patch({ name: v })} />
              <Editable label={current?.idLabel ?? "מזהה"} value={r.recordCode} disabled={!canWrite} onSave={(v) => patch({ recordCode: v })} />
              <Editable label="טלפון" value={r.phone ?? ""} disabled={!canWrite} onSave={(v) => patch({ phone: v || null })} />
              <Editable label="מספר פונה" value={r.callerPhone ?? ""} disabled={!canWrite} onSave={(v) => patch({ callerPhone: v || null })} />
              <Editable label="מייל" value={r.email ?? ""} disabled={!canWrite} onSave={(v) => patch({ email: v || null })} />
              <Editable label="מקור" value={r.source ?? ""} disabled={!canWrite} onSave={(v) => patch({ source: v || null })} />
              {fields.map((f) => (
                <Editable
                  key={f.id}
                  label={f.label}
                  value={String(r.custom?.[f.fieldKey] ?? "")}
                  disabled={!canWrite}
                  onSave={(v) => patch({ custom: { ...r.custom, [f.fieldKey]: v } })}
                />
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold mb-2">הערות</h2>
            {canWrite && (
              <div className="flex gap-2 mb-3">
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                  placeholder="הוסף הערה..."
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                />
                <button onClick={addNote} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm">הוסף</button>
              </div>
            )}
            <div className="space-y-2">
              {data.notes.length === 0 && <p className="text-xs text-muted-foreground">אין הערות</p>}
              {data.notes.map((n) => (
                <div key={n.id} className="rounded-lg border border-border p-2">
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {n.authorName ?? "—"} · {new Date(n.createdAt).toLocaleString("he-IL")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-2">יומן פעילות</h2>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {data.activity.length === 0 && <p className="text-xs text-muted-foreground">אין פעילות</p>}
            {data.activity.map((a) => (
              <div key={a.id} className="text-xs border-r-2 border-border pr-2">
                <div className="font-medium">
                  {a.action === "create" ? "נפתחה פניה" : `עודכן ${a.field ?? ""}`}
                </div>
                {a.action !== "create" && (
                  <div className="text-muted-foreground">{a.oldValue || "—"} ← {a.newValue || "—"}</div>
                )}
                <div className="text-muted-foreground">{a.actorName ?? "—"} · {new Date(a.createdAt).toLocaleString("he-IL")}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Editable({ label, value, onSave, disabled }: { label: string; value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  return (
    <div>
      <label className="text-xs font-medium block mb-1">{label}</label>
      <div className="flex gap-1">
        <input
          value={dirty ? draft : value}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-60"
        />
        {dirty && !disabled && (
          <button onClick={() => onSave(draft)} className="rounded-lg bg-primary text-primary-foreground px-2" title="שמור">
            <Save className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
