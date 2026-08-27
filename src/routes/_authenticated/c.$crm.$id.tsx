import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, Clock, Mail, Phone, Save, Send, Trash2 } from "lucide-react";
import { useMyCrms } from "@/lib/use-crms";
import { getRecord, updateRecord, addRecordNote, deleteRecord, deleteRecordNote, listFieldDefs, updateRecordNote } from "@/lib/crm-records.functions";
import { listAgents } from "@/lib/systems.functions";
import { listRecordEmailThread, sendRecordEmail } from "@/lib/email.functions";
import { GENERIC_STATUSES } from "./c.$crm.index";
import { EmailContentEditor } from "@/components/EmailContentEditor";
import type { EmailCleanupLevel } from "@/lib/email-cleanup";

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
  const agentsFn = useServerFn(listAgents);
  const emailFn = useServerFn(listRecordEmailThread);
  const sendEmailFn = useServerFn(sendRecordEmail);
  const editNoteFn = useServerFn(updateRecordNote);
  const deleteNoteFn = useServerFn(deleteRecordNote);

  const { data, isLoading } = useQuery({
    queryKey: ["crm_record", id],
    queryFn: async () => getFn({ data: { id } }),
  });
  const { data: fields = [] } = useQuery({
    queryKey: ["crm_field_defs", crm],
    queryFn: async () => fieldsFn({ data: { crmKey: crm } }),
  });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn(), staleTime: 5 * 60_000 });
  const { data: emails = [] } = useQuery({ queryKey: ["crm_record_emails", id], queryFn: async () => emailFn({ data: { record_id: id } }) });

  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");
  const [emailCleanupLevel, setEmailCleanupLevel] = useState<EmailCleanupLevel>("standard");
  const mentionNames = useMemo(() => agents.map((a: any) => a.display_name).filter(Boolean), [agents]);

  function renderMentions(body: string) {
    const parts = body.split(/(@[^\s@]+)/g);
    return parts.map((part, index) => part.startsWith("@")
      ? <span key={index} className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{part}</span>
      : part);
  }

  async function sendMail(threadId?: string | null) {
    if (!r.email || !mailBody.trim()) return;
    try {
      await sendEmailFn({ data: { record_id: id, to: r.email, subject: mailSubject || `פניה ${r.recordCode}`, body: mailBody, gmail_thread_id: threadId, cleanup_level: emailCleanupLevel } });
      setMailBody(""); setMailOpen(false);
      await qc.invalidateQueries({ queryKey: ["crm_record_emails", id] });
      toast.success("המייל נשלח");
    } catch (e: any) { toast.error(e?.message ?? "שליחת המייל נכשלה"); }
  }

  async function patch(p: Record<string, any>) {
    setBusy(true);
    try {
      await updateFn({ data: { id, patch: p } });
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
      await noteFn({ data: { recordId: id, crmKey: crm, body: noteText } });
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
        <button onClick={() => setMailOpen((v) => !v)} disabled={!r.email} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40">
          <Mail className="h-3.5 w-3.5" /> מייל
        </button>
        {current?.myRole === "admin" || current?.myRole === "super_admin" ? (
          <button
            onClick={async () => {
              if (!confirm("למחוק את הפניה?")) return;
              await delFn({ data: { id } });
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
              <div>
                <label className="text-xs font-medium block mb-1">תזכורת</label>
                <input type="datetime-local" value={r.reminderAt ? new Date(r.reminderAt).toISOString().slice(0, 16) : ""} disabled={!canWrite}
                  onChange={(e) => patch({ reminderAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-60" />
              </div>
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
                  list="crm-mention-options"
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                />
                <datalist id="crm-mention-options">{mentionNames.map((name) => <option key={name} value={`@${name}`} />)}</datalist>
                <button onClick={addNote} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm">הוסף</button>
              </div>
            )}
            <div className="space-y-2">
              {data.notes.length === 0 && <p className="text-xs text-muted-foreground">אין הערות</p>}
              {data.notes.map((n) => (
                <div key={n.id} className="rounded-lg border border-border p-2">
                  <p className="text-sm whitespace-pre-wrap">{renderMentions(n.body)}</p>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {n.authorName ?? "—"} · {new Date(n.createdAt).toLocaleString("he-IL")}
                  </div>
                  {canWrite && <div className="flex gap-2 mt-1 text-[11px]">
                    <button onClick={async () => { const body = prompt("עריכת הערה", n.body); if (!body?.trim()) return; await editNoteFn({ data: { id: n.id, body } }); qc.invalidateQueries({ queryKey: ["crm_record", id] }); }} className="text-primary">ערוך</button>
                    <button onClick={async () => { if (!confirm("למחוק הערה?")) return; await deleteNoteFn({ data: { id: n.id } }); qc.invalidateQueries({ queryKey: ["crm_record", id] }); }} className="text-destructive">מחק</button>
                  </div>}
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

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Mail className="h-4 w-4" />התכתבות במייל</h2>
          {r.reminderAt && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(r.reminderAt).toLocaleString("he-IL")}</span>}
        </div>
        {mailOpen && <div className="grid gap-2 mb-3">
          <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} placeholder="נושא" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          <EmailContentEditor value={mailBody} onChange={setMailBody} rows={4}
            cleanupLevel={emailCleanupLevel} onCleanupLevelChange={setEmailCleanupLevel} />
          <button onClick={() => sendMail(null)} className="justify-self-start flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"><Send className="h-4 w-4" />שלח</button>
        </div>}
        <div className="space-y-2">
          {emails.length === 0 && <p className="text-xs text-muted-foreground">אין עדיין התכתבות</p>}
          {emails.map((message: any) => <div key={message.id} className={`rounded-lg border p-3 ${message.direction === "outbound" ? "mr-8 bg-accent/30" : "ml-8 bg-background"}`}>
            <div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{message.direction === "outbound" ? message.agent_name ?? "נציג" : message.from_address}</span><span>{new Date(message.created_at).toLocaleString("he-IL")}</span></div>
            {message.subject && <div className="font-medium text-sm mt-1">{message.subject}</div>}
            <p className="text-sm whitespace-pre-wrap mt-1">{message.body}</p>
            {message.direction === "inbound" && canWrite && <button onClick={() => { setMailOpen(true); setMailSubject(message.subject?.startsWith("Re:") ? message.subject : `Re: ${message.subject ?? ""}`); setMailBody(""); }} className="text-xs text-primary mt-2">השב</button>}
          </div>)}
        </div>
      </section>
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
