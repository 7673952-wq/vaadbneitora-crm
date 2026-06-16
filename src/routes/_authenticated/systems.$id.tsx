import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSystem, listAgents, listMainSystems,
  updateSystem, addNote, deleteSystem, addSubSystem,
  setReminder, dismissReminder, setParent,
} from "@/lib/systems.functions";
import { getMyRole } from "@/lib/admin.functions";
import {
  listSystemFiles, uploadSystemFile, getSystemFileUrl, deleteSystemFile,
} from "@/lib/system-files.functions";
import {
  STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, toneClasses, statusCardClasses,
  NO_REASON_STATUSES, type SystemStatus,
} from "@/lib/status";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  ArrowRight, History, MessageSquare, Trash2, Send, Plus, Network,
  Phone, Bell, BellOff, Activity, Link as LinkIcon, CornerUpRight,
  Info, Paperclip, Upload, Download, FileText,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/systems/$id")({
  head: () => ({ meta: [{ title: "מערכת | CRM" }] }),
  component: SystemDetail,
});



const FIELD_LABELS: Record<string, string> = {
  status: "סטטוס",
  assigned_agent_id: "נציג מטפל",
  name: "שם",
  notes: "הערות",
  phone: "טלפון",
  reminder_at: "תזכורת",
  parent_system_id: "מערכת אב",
};

function SystemDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getSystem);
  const agentsFn = useServerFn(listAgents);
  const mainsFn = useServerFn(listMainSystems);
  const updateFn = useServerFn(updateSystem);
  const noteFn = useServerFn(addNote);
  const deleteFn = useServerFn(deleteSystem);
  const meFn = useServerFn(getMyRole);
  const subFn = useServerFn(addSubSystem);
  const reminderFn = useServerFn(setReminder);
  const dismissFn = useServerFn(dismissReminder);
  const parentFn = useServerFn(setParent);

  const { data, isLoading } = useQuery({ queryKey: ["system", id], queryFn: () => getFn({ data: { id } }) });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data: mains } = useQuery({ queryKey: ["mainSystems"], queryFn: () => mainsFn() });
  const [noteText, setNoteText] = useState("");
  const [subCode, setSubCode] = useState("");
  const [subName, setSubName] = useState("");
  const [customDate, setCustomDate] = useState<string>("");
  const [showParentPick, setShowParentPick] = useState(false);
  const [parentChoice, setParentChoice] = useState<string>("");
  const [reminderAgentIds, setReminderAgentIds] = useState<string[]>([]);
  const [reminderScope, setReminderScope] = useState<"all" | "specific">("all");
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const filesFn = useServerFn(listSystemFiles);
  const uploadFn = useServerFn(uploadSystemFile);
  const fileUrlFn = useServerFn(getSystemFileUrl);
  const deleteFileFn = useServerFn(deleteSystemFile);
  const { data: files } = useQuery({
    queryKey: ["system-files", id],
    queryFn: () => filesFn({ data: { system_id: id } }),
  });
  const deleteFileMut = useMutation({
    mutationFn: (file_id: string) => deleteFileFn({ data: { file_id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system-files", id] }); toast.success("הקובץ נמחק"); },
    onError: (e: any) => toast.error(e.message),
  });
  async function downloadFile(file_id: string) {
    try {
      const { url } = await fileUrlFn({ data: { file_id } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { toast.error("הקובץ גדול מדי (מקסימום 15MB)"); e.target.value = ""; return; }
    try {
      setUploading(true);
      const buf = await f.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      await uploadFn({ data: { system_id: id, file_name: f.name, mime_type: f.type || "", data_base64: b64 } });
      toast.success("הקובץ הועלה");
      qc.invalidateQueries({ queryKey: ["system-files", id] });
    } catch (err: any) {
      toast.error(err.message ?? "שגיאה בהעלאה");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const updateMut = useMutation({
    mutationFn: updateFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); qc.invalidateQueries({ queryKey: ["systems"] }); toast.success("עודכן"); },
    onError: (e: any) => toast.error(e.message),
  });
  const noteMut = useMutation({
    mutationFn: noteFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); setNoteText(""); toast.success("ההערה נוספה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => { toast.success("נמחק"); navigate({ to: "/dashboard" }); },
    onError: (e: any) => toast.error(e.message),
  });
  const subMut = useMutation({
    mutationFn: subFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system", id] });
      setSubCode(""); setSubName("");
      toast.success("תת-מערכת נוספה");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const reminderMut = useMutation({
    mutationFn: reminderFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("התזכורת נקבעה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const dismissMut = useMutation({
    mutationFn: dismissFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("התזכורת בוטלה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const parentMut = useMutation({
    mutationFn: parentFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system", id] });
      qc.invalidateQueries({ queryKey: ["systems"] });
      setShowParentPick(false);
      toast.success("המבנה עודכן");
    },
    onError: (e: any) => toast.error(e.message),
  });

  useEffect(() => {
    const ids: string[] = (data?.system as any)?.reminder_agent_ids ?? [];
    setReminderAgentIds(ids);
    setReminderScope(ids.length === 0 ? "all" : "specific");
  }, [data?.system?.id]);

  if (isLoading || !data) return <div className="text-center py-20 text-muted-foreground">טוען...</div>;
  const s = data.system;
  const isSub = !!s.parent_system_id;
  const headerCard = statusCardClasses(s.status);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="h-4 w-4" />חזרה לדשבורד
      </Link>

      {isSub && data.parent && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <CornerUpRight className="h-4 w-4" />
            <span>זוהי <strong>תת-מערכת</strong> של:</span>
            <Link to="/systems/$id" params={{ id: data.parent.id }}
              className="font-mono text-xs bg-white/60 rounded px-2 py-0.5 hover:bg-white">
              {data.parent.system_code}
            </Link>
            <Link to="/systems/$id" params={{ id: data.parent.id }} className="font-medium hover:underline">
              {data.parent.name}
            </Link>
          </div>
          <Link to="/systems/$id" params={{ id: data.parent.id }}
            className="text-xs underline hover:no-underline">לפתיחת המערכת הראשית</Link>
        </div>
      )}

      <div className={`border-2 rounded-2xl p-6 transition ${headerCard}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            {me?.isAdmin ? (
              <input
                defaultValue={s.system_code || ""}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== (s.system_code || "")) updateMut.mutate({ data: { id, system_code: v } }); }}
                className="text-base font-mono font-semibold opacity-90 bg-white/40 rounded px-2 py-1 border border-current/20 w-48"
                title="מזהה מערכת (ניתן לעריכה ע״י מנהל)"
              />
            ) : (
              <div className="text-base font-mono font-semibold opacity-90">{s.system_code}</div>
            )}
            {me?.isAdmin ? (
              <input
                defaultValue={s.name || ""}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) updateMut.mutate({ data: { id, name: v } }); }}
                className="text-3xl font-bold tracking-tight mt-1 bg-transparent border-b border-current/20 focus:outline-none focus:border-current w-full"
              />
            ) : (
              <h1 className="text-3xl font-bold tracking-tight mt-1">{s.name}</h1>
            )}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <span className={`text-xs rounded-full px-3 py-1 font-medium ${toneClasses(STATUS_TONE[s.status as SystemStatus])}`}>
                {STATUS_LABEL[s.status as SystemStatus]}
              </span>
              <span className="text-sm opacity-80">נציג: <span className="font-medium">{s.agent_name || "לא משויך"}</span></span>
              {isSub && <span className="text-xs bg-white/60 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5 font-medium">תת-מערכת</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {s.phone && (
              <a href={`tel:${s.phone}`}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                <Phone className="h-4 w-4" />חיוג {s.phone}
              </a>
            )}
            {me?.isAdmin && (
              <button onClick={() => { if (confirm("למחוק מערכת זו?")) deleteMut.mutate({ data: { id } }); }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/10 bg-white/70">
                <Trash2 className="h-4 w-4" />מחק
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===== פרטים ===== */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold flex items-center gap-2 mb-4"><Info className="h-4 w-4" />פרטים</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium block mb-2">סטטוס</label>
            <select value={s.status} onChange={(e) => {
              const newStatus = e.target.value;
              if (newStatus === s.status) return;
              if (NO_REASON_STATUSES.has(newStatus)) {
                updateMut.mutate({ data: { id, status: newStatus } });
                return;
              }
              const reason = window.prompt("סיבת שינוי הסטטוס (חובה):", "");
              if (!reason || !reason.trim()) { toast.error("יש להזין סיבה"); return; }
              updateMut.mutate({ data: { id, status: newStatus, reason: reason.trim() } });
            }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">נציג מטפל</label>
            <select value={s.assigned_agent_id || ""} onChange={(e) => updateMut.mutate({ data: { id, assigned_agent_id: e.target.value || null } })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground">
              <option value="">— לא משויך —</option>
              {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">טלפון לחיוג</label>
            <input
              defaultValue={s.phone || ""}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.phone || "")) updateMut.mutate({ data: { id, phone: v || null } }); }}
              placeholder="מספר טלפון"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">דוא"ל</label>
            <EmailField initial={(s as any).email || ""} onSave={(v) => updateMut.mutate({ data: { id, email: v } })} />
          </div>
          {me?.isAdmin && (
            <div>
              <label className="text-sm font-medium block mb-2">מבנה</label>
              <div className="flex items-center gap-2 flex-wrap">
                {!isSub ? (
                  <button onClick={() => { setShowParentPick(true); setParentChoice(""); }}
                    className="text-xs px-3 py-2 border border-input rounded-lg bg-background hover:bg-accent">
                    הפוך לתת-מערכת
                  </button>
                ) : (
                  <button onClick={() => parentMut.mutate({ data: { id, parent_system_id: null } })}
                    className="text-xs px-3 py-2 border border-input rounded-lg bg-background hover:bg-accent">
                    הפוך למערכת ראשית
                  </button>
                )}
                {showParentPick && !isSub && (
                  <div className="flex items-center gap-1">
                    <select value={parentChoice} onChange={(e) => setParentChoice(e.target.value)}
                      className="text-xs rounded-md border border-input bg-background px-2 py-1.5">
                      <option value="">— בחר אב —</option>
                      {(mains ?? []).filter((m: any) => m.id !== id).map((m: any) => (
                        <option key={m.id} value={m.id}>{m.system_code} · {m.name}</option>
                      ))}
                    </select>
                    <button disabled={!parentChoice}
                      onClick={() => parentMut.mutate({ data: { id, parent_system_id: parentChoice } })}
                      className="text-xs px-2 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50">אשר</button>
                    <button onClick={() => setShowParentPick(false)}
                      className="text-xs px-2 py-1.5 border border-input rounded-md">ביטול</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ===== מעקב — תזכורות ===== */}
        <div className="mt-8 pt-6 border-t border-border">
          <h2 className="font-semibold flex items-center gap-2 mb-4"><Bell className="h-4 w-4" />מעקב — תזכורות</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                <Bell className="h-4 w-4" />
                {s.reminder_at ? (
                  <span>
                    תזכורת מתוכננת ל-<strong>{new Date(s.reminder_at).toLocaleString("he-IL")}</strong>
                    {((s as any).reminder_agent_ids?.length ?? 0) > 0 && (
                      <span className="opacity-80"> · עבור: {((s as any).reminder_agent_ids as string[]).map((aid) => (agents ?? []).find((a: any) => a.id === aid)?.display_name).filter(Boolean).join(", ")}</span>
                    )}
                  </span>
                ) : (
                  <span className="opacity-70">אין תזכורת מוגדרת</span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {(["day","week","month","2months","year"] as const).map((r) => (
                  <button key={r} onClick={() => reminderMut.mutate({ data: { system_id: id, repeat: r, agent_ids: reminderScope === "specific" ? reminderAgentIds : [] } })}
                    className="text-xs px-2 py-1 border border-input rounded-md bg-background hover:bg-accent text-foreground">
                    {r === "day" ? "מחר" : r === "week" ? "+שבוע" : r === "month" ? "+חודש" : r === "2months" ? "+חודשיים" : "+שנה"}
                  </button>
                ))}
                <input type="datetime-local" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
                  className="text-xs px-2 py-1 border border-input rounded-md bg-background text-foreground" />
                <button disabled={!customDate}
                  onClick={() => reminderMut.mutate({ data: { system_id: id, repeat: "custom", custom_date: new Date(customDate).toISOString(), agent_ids: reminderScope === "specific" ? reminderAgentIds : [] } })}
                  className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-md disabled:opacity-50">קבע</button>
                {s.reminder_at && (
                  <button onClick={() => dismissMut.mutate({ data: { system_id: id } })}
                    className="text-xs px-2 py-1 border border-input rounded-md bg-background hover:bg-accent text-foreground flex items-center gap-1">
                    <BellOff className="h-3 w-3" />בטל
                  </button>
                )}
              </div>
            </div>

            <div className="text-xs space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="opacity-80">שיוך התזכורת:</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name="reminder-scope" checked={reminderScope === "all"}
                    onChange={() => { setReminderScope("all"); setReminderAgentIds([]); }} />
                  כל הנציגים
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name="reminder-scope" checked={reminderScope === "specific"}
                    onChange={() => setReminderScope("specific")} />
                  נציגים נבחרים
                </label>
                {reminderScope === "specific" && (
                  <>
                    <button type="button" onClick={() => setReminderAgentIds((agents ?? []).map((a: any) => a.id))}
                      className="px-2 py-0.5 border border-input rounded-md bg-background hover:bg-accent">סמן הכל</button>
                    <button type="button" onClick={() => setReminderAgentIds([])}
                      className="px-2 py-0.5 border border-input rounded-md bg-background hover:bg-accent">נקה</button>
                  </>
                )}
              </div>
              {reminderScope === "specific" && (
                <div className="flex flex-wrap gap-2 p-2 border border-input rounded-md bg-background max-h-40 overflow-auto">
                  {(agents ?? []).map((a: any) => {
                    const checked = reminderAgentIds.includes(a.id);
                    return (
                      <label key={a.id} className={`flex items-center gap-1 px-2 py-1 rounded-md border cursor-pointer ${checked ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"}`}>
                        <input type="checkbox" className="hidden" checked={checked}
                          onChange={(e) => setReminderAgentIds((prev) => e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id))} />
                        {a.display_name}
                      </label>
                    );
                  })}
                  {(agents ?? []).length === 0 && <span className="opacity-70">אין נציגים זמינים</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== הערות + יומן שינויים זה לצד זה ===== */}
        <div className="mt-8 pt-6 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* הערות */}
          <div>
            <h2 className="font-semibold flex items-center gap-2 mb-4"><MessageSquare className="h-4 w-4" />הערות ({data.notes.length})</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) noteMut.mutate({ data: { system_id: id, body: noteText.trim() } }); }}
              className="flex gap-2 mb-4">
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="הוסף הערה..."
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <button type="submit" className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                <Send className="h-4 w-4" />
              </button>
            </form>
            <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
              {data.notes.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">אין הערות עדיין</p>}
              {data.notes.map((n: any) => (
                <div key={n.id} className="border border-border rounded-lg p-3 bg-background">
                  <div className="text-sm whitespace-pre-wrap">{n.body}</div>
                  <div className="text-xs text-muted-foreground mt-2 flex justify-between">
                    <span>{n.author_name}</span>
                    <span>{new Date(n.created_at).toLocaleString("he-IL")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* היסטוריה משולבת (יומן + העברות נציג) */}
          <div>
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <History className="h-4 w-4" />היסטוריה ({data.activity.length + data.transfers.length})
            </h2>
            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {(() => {
                const merged = [
                  ...data.activity.map((a: any) => ({ kind: "activity" as const, at: a.created_at, item: a })),
                  ...data.transfers.map((t: any) => ({ kind: "transfer" as const, at: t.created_at, item: t })),
                ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

                if (merged.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-8">אין פעילות</p>;
                }
                return merged.map((row) => {
                  if (row.kind === "transfer") {
                    const t = row.item;
                    return (
                      <div key={`t-${t.id}`} className="rounded-lg border border-border bg-background p-3">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1.5">
                          <span className="font-medium text-foreground">{t.by_name}</span>
                          <span>{new Date(t.created_at).toLocaleString("he-IL")}</span>
                        </div>
                        <div className="text-sm flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 text-xs font-medium">העברת נציג</span>
                          <span className="text-muted-foreground line-through text-xs">{t.from_name || "—"}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium text-sm">{t.to_name || "—"}</span>
                        </div>
                      </div>
                    );
                  }
                  const a = row.item;
                  const oldDisp = a.field === "assigned_agent_id" ? (a.old_agent_name || formatValue(a.field, a.old_value)) : formatValue(a.field, a.old_value);
                  const newDisp = a.field === "assigned_agent_id" ? (a.new_agent_name || formatValue(a.field, a.new_value)) : formatValue(a.field, a.new_value);
                  const isStatus = a.field === "status";
                  return (
                    <div key={`a-${a.id}`} className="rounded-lg border border-border bg-background p-3 hover:bg-accent/30 transition">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1.5">
                        <span className="font-medium text-foreground">{a.actor_name}</span>
                        <span>{new Date(a.created_at).toLocaleString("he-IL")}</span>
                      </div>
                      <div className="text-sm flex items-center gap-2 flex-wrap">
                        {a.action === "created" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-xs font-medium">נוצרה מערכת</span>
                        )}
                        {a.action === "deleted" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-900 text-xs font-medium">נמחקה</span>
                        )}
                        {a.action === "updated" && (
                          <>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-foreground text-xs font-medium">
                              {FIELD_LABELS[a.field] || a.field}
                            </span>
                            {isStatus ? (
                              <>
                                <span className={`text-xs rounded-full px-2 py-0.5 ${toneClasses(STATUS_TONE[a.old_value as SystemStatus])}`}>{oldDisp}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className={`text-xs rounded-full px-2 py-0.5 ${toneClasses(STATUS_TONE[a.new_value as SystemStatus])}`}>{newDisp}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-muted-foreground line-through text-xs">{oldDisp}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className="font-medium text-sm">{newDisp}</span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                      {isStatus ? (
                        <div className="text-xs mt-2 text-amber-900 bg-amber-50 border-r-2 border-amber-400 px-2 py-1 rounded">
                          <span className="font-semibold">סיבת שינוי הסטטוס:</span> {a.reason || "לא נרשמה סיבה"}
                        </div>
                      ) : a.reason && (
                        <div className="text-xs mt-2 text-amber-900 bg-amber-50 border-r-2 border-amber-400 px-2 py-1 rounded">
                          <span className="font-semibold">סיבה:</span> {a.reason}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </div>


      {/* ===== תתי-מערכות ===== */}
      {!isSub && (
        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Network className="h-4 w-4" />תתי-מערכות ({data.children.length})
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            תתי-מערכות יורשות אוטומטית את הסטטוס והנציג של המערכת הראשית.
          </p>
          {(me?.isAdmin || s.assigned_agent_id === me?.userId) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (subCode.trim()) subMut.mutate({ data: { parent_id: id, system_code: subCode.trim(), name: subName.trim() || undefined } });
              }}
              className="flex gap-2 mb-4 flex-wrap"
            >
              <input value={subCode} onChange={(e) => setSubCode(e.target.value)} placeholder="מספר / מזהה"
                className="flex-1 min-w-[140px] rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="שם (אופציונלי)"
                className="flex-1 min-w-[140px] rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <button type="submit" className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm">
                <Plus className="h-4 w-4" />הוסף
              </button>
            </form>
          )}
          <div className="space-y-2">
            {data.children.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">אין תתי-מערכות</p>}
            {data.children.map((c: any) => (
              <Link key={c.id} to="/systems/$id" params={{ id: c.id }}
                className={`flex items-center justify-between gap-3 border-2 rounded-lg p-3 transition ${statusCardClasses(c.status)}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <LinkIcon className="h-3.5 w-3.5 opacity-60 shrink-0" />
                  <span className="text-xs font-mono opacity-80 shrink-0">{c.system_code}</span>
                  <span className="text-sm truncate font-medium">{c.name}</span>
                </div>
                <span className={`text-xs rounded-full px-2 py-0.5 font-medium shrink-0 ${toneClasses(STATUS_TONE[c.status as SystemStatus])}`}>
                  {STATUS_LABEL[c.status as SystemStatus]}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ===== קבצים ===== */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="font-semibold flex items-center gap-2"><Paperclip className="h-4 w-4" />קבצים ({files?.length ?? 0})</h2>
          {(me?.isAdmin || s.assigned_agent_id === me?.userId) && (
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {uploading ? "מעלה..." : "העלה קובץ"}
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">עד 15MB לקובץ. רק מנהל או הנציג המשויך יכולים להעלות.</p>
        {!files || files.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">אין קבצים</p>
        ) : (
          <div className="divide-y divide-border">
            {files.map((f: any) => (
              <div key={f.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{f.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(f.size_bytes / 1024).toFixed(1)} KB · {f.uploader_name ?? "—"} · {new Date(f.created_at).toLocaleString("he-IL")}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => downloadFile(f.id)} className="p-2 rounded-lg hover:bg-accent" title="הורד">
                    <Download className="h-4 w-4" />
                  </button>
                  {(me?.isAdmin || f.uploaded_by === me?.userId) && (
                    <button onClick={() => { if (confirm("למחוק את הקובץ?")) deleteFileMut.mutate(f.id); }}
                      className="p-2 rounded-lg text-destructive hover:bg-destructive/10" title="מחק">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>


  );
}

function formatValue(field: string, value: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "status") return STATUS_LABEL[value as SystemStatus] || value;
  if (field === "reminder_at") {
    try { return new Date(value).toLocaleString("he-IL"); } catch { return value; }
  }
  if (field === "assigned_agent_id" || field === "parent_system_id") {
    return value.slice(0, 8) + "…";
  }
  return value;
}

function EmailField({ initial, onSave }: { initial: string; onSave: (v: string | null) => void }) {
  const [val, setVal] = useState(initial);
  const commit = () => {
    const v = val.trim();
    if (v === (initial || "")) return;
    onSave(v || null);
  };
  return (
    <div className="flex gap-1">
      <input
        type="email"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        placeholder="name@example.com"
        className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground" />
      <button
        type="button"
        onClick={() => { if (val && !val.includes("@")) setVal(val + "@gmail.com"); }}
        className="text-xs px-2 py-2 border border-input rounded-lg bg-background hover:bg-accent whitespace-nowrap"
        title="הוסף @gmail.com">
        @gmail.com
      </button>
    </div>
  );
}

