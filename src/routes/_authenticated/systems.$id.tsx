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
  STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, toneClasses, statusCardClasses,
  type SystemStatus,
} from "@/lib/status";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight, History, MessageSquare, Trash2, Send, Plus, Network,
  Phone, Bell, BellOff, Activity, Link as LinkIcon, CornerUpRight,
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
          <div>
            <div className="text-xs font-mono opacity-70">{s.system_code}</div>
            <h1 className="text-3xl font-bold tracking-tight mt-1">{s.name}</h1>
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

        <div className="grid md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-current/20">
          <div>
            <label className="text-sm font-medium block mb-2">סטטוס</label>
            <select value={s.status} onChange={(e) => {
              const newStatus = e.target.value;
              if (newStatus === s.status) return;
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

        {/* Reminder */}
        <div className="mt-4 pt-4 border-t border-current/20">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <Bell className="h-4 w-4" />
              {s.reminder_at ? (
                <span>תזכורת מתוכננת ל-<strong>{new Date(s.reminder_at).toLocaleString("he-IL")}</strong></span>
              ) : (
                <span className="opacity-70">אין תזכורת מוגדרת</span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {(["day","week","month","2months","year"] as const).map((r) => (
                <button key={r} onClick={() => reminderMut.mutate({ data: { system_id: id, repeat: r } })}
                  className="text-xs px-2 py-1 border border-input rounded-md bg-background hover:bg-accent text-foreground">
                  {r === "day" ? "מחר" : r === "week" ? "+שבוע" : r === "month" ? "+חודש" : r === "2months" ? "+חודשיים" : "+שנה"}
                </button>
              ))}
              <input type="datetime-local" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
                className="text-xs px-2 py-1 border border-input rounded-md bg-background text-foreground" />
              <button disabled={!customDate}
                onClick={() => reminderMut.mutate({ data: { system_id: id, repeat: "custom", custom_date: new Date(customDate).toISOString() } })}
                className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-md disabled:opacity-50">קבע</button>
              {s.reminder_at && (
                <button onClick={() => dismissMut.mutate({ data: { system_id: id } })}
                  className="text-xs px-2 py-1 border border-input rounded-md bg-background hover:bg-accent text-foreground flex items-center gap-1">
                  <BellOff className="h-3 w-3" />בטל
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="font-semibold flex items-center gap-2 mb-4"><MessageSquare className="h-4 w-4" />הערות ({data.notes.length})</h2>
          <form onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) noteMut.mutate({ data: { system_id: id, body: noteText.trim() } }); }}
            className="flex gap-2 mb-4">
            <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="הוסף הערה..."
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <button type="submit" className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="space-y-3 max-h-96 overflow-y-auto">
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

        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="font-semibold flex items-center gap-2 mb-4"><Activity className="h-4 w-4" />יומן שינויים ({data.activity.length})</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.activity.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">אין שינויים</p>}
            {data.activity.map((a: any) => (
              <div key={a.id} className="border-r-2 border-primary pr-3">
                <div className="text-sm">
                  {a.action === "created" && <><span className="font-medium">נוצרה מערכת</span> — {a.new_value}</>}
                  {a.action === "deleted" && <><span className="font-medium text-destructive">נמחקה</span></>}
                  {a.action === "updated" && (
                    <>
                      <span className="font-medium">{FIELD_LABELS[a.field] || a.field}</span>
                      <span className="text-muted-foreground mx-1">:</span>
                      <span className="text-muted-foreground">{formatValue(a.field, a.old_value)}</span>
                      <span className="mx-1">→</span>
                      <span className="font-medium">{formatValue(a.field, a.new_value)}</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.actor_name} · {new Date(a.created_at).toLocaleString("he-IL")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold flex items-center gap-2 mb-4"><History className="h-4 w-4" />היסטוריית העברות נציג ({data.transfers.length})</h2>
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {data.transfers.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">אין העברות</p>}
          {data.transfers.map((t: any) => (
            <div key={t.id} className="border-r-2 border-primary pr-3">
              <div className="text-sm">
                <span className="text-muted-foreground">{t.from_name}</span>
                <span className="mx-2">→</span>
                <span className="font-medium">{t.to_name}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                ע"י {t.by_name} · {new Date(t.created_at).toLocaleString("he-IL")}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!isSub && (
        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Network className="h-4 w-4" />תתי-מערכות (מספרים נוספים) ({data.children.length})
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            תתי-מערכות יורשות אוטומטית את הסטטוס והנציג של המערכת הראשית. לא ניתן להוסיף תת-מערכת בתוך תת-מערכת.
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
