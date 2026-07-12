import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSystem, listAgents, listMainSystems,
  updateSystem, addNote, deleteSystem, addSubSystem,
  setReminder, dismissReminder, setParent, sendVoiceMessage,
  addAdditionalCallerPhone, updateAdditionalCallerPhone, removeAdditionalCallerPhone,
} from "@/lib/systems.functions";

import { getMyRole, listStatusSettings } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import {
  listSystemFiles, uploadSystemFile, getSystemFileUrl, deleteSystemFile,
} from "@/lib/system-files.functions";
import {
  STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, STATUS_MANDATORY, toneClasses, statusCardClasses,
  statusRequiresReason, type SystemStatus, buildDialNumber,
} from "@/lib/status";
import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowRight, History, MessageSquare, Trash2, Send, Plus, Network,
  Phone, Bell, BellOff, Activity, Link as LinkIcon, CornerUpRight,
  Info, Paperclip, Upload, Download, FileText, ChevronDown, Copy, Check, Volume2,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { SystemPresence } from "@/components/SystemPresence";


export const Route = createFileRoute("/_authenticated/systems/$id")({
  head: () => ({ meta: [{ title: "מערכת | CRM" }] }),
  component: SystemDetail,
});

function ReminderSection({ hasReminder, headerSummary, children }: { hasReminder: boolean; headerSummary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState<boolean>(hasReminder);
  useEffect(() => { setOpen(hasReminder); }, [hasReminder]);
  return (
    <div className="mt-8 pt-6 border-t border-border">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border transition ${hasReminder ? "border-amber-300 bg-amber-50 hover:bg-amber-100" : "border-border bg-background hover:bg-accent"}`}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell className={`h-4 w-4 ${hasReminder ? "text-amber-700" : ""}`} />
          מעקב — תזכורות
          <span className="font-normal text-muted-foreground">· {headerSummary}</span>
        </div>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}




const FIELD_LABELS: Record<string, string> = {
  status: "סטטוס",
  assigned_agent_id: "נציג מטפל",
  name: "שם",
  notes: "הערות",
  phone: "טלפון",
  caller_phone: "מספר פונה",
  reminder_at: "תזכורת",
  parent_system_id: "מערכת אב",
};

function SystemDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyToClipboard(value: string, key: string, label: string) {
    navigator.clipboard.writeText(value)
      .then(() => {
        toast.success(`${label} הועתק`);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      })
      .catch(() => toast.error("ההעתקה נכשלה"));
  }

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
  const voiceFn = useServerFn(sendVoiceMessage);
  const statusSettingsFn = useServerFn(listStatusSettings);

  const { data, isLoading } = useQuery({ queryKey: ["system", id], queryFn: () => getFn({ data: { id } }) });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({ headers: await getAuthHeaders() }) });
  const { data: mains } = useQuery({ queryKey: ["mainSystems"], queryFn: () => mainsFn() });
  const { data: statusSettings } = useQuery({ queryKey: ["status_settings"], queryFn: () => statusSettingsFn() });
  const [noteText, setNoteText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system", id] });
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
      setNoteText("");
      setMentionOpen(false);
      toast.success("ההערה נוספה");
    },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); qc.invalidateQueries({ queryKey: ["my_due_reminders"] }); toast.success("התזכורת נקבעה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const dismissMut = useMutation({
    mutationFn: dismissFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); qc.invalidateQueries({ queryKey: ["my_due_reminders"] }); toast.success("התזכורת בוטלה"); },
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
  const voiceMut = useMutation({
    mutationFn: (v: { systemId: string; phoneIndex?: number }) => voiceFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("ההודעה הקולית נשלחה בהצלחה"); },
    onError: (e: any) => toast.error(e.message ?? "שליחת ההודעה נכשלה"),
  });
  const addPhoneFn = useServerFn(addAdditionalCallerPhone);
  const updPhoneFn = useServerFn(updateAdditionalCallerPhone);
  const rmPhoneFn = useServerFn(removeAdditionalCallerPhone);
  const setCachedAdditionalPhones = (updater: (phones: Array<{ phone: string; sent_at?: string }>) => Array<{ phone: string; sent_at?: string }>) => {
    qc.setQueryData(["system", id], (old: any) => {
      if (!old?.system) return old;
      const current = Array.isArray(old.system.additional_caller_phones) ? old.system.additional_caller_phones : [];
      return { ...old, system: { ...old.system, additional_caller_phones: updater(current) } };
    });
  };
  const addPhoneMut = useMutation({
    mutationFn: (v: { systemId: string; phone: string }) => addPhoneFn({ data: v }),
    onSuccess: (res: any, vars) => {
      if (Array.isArray(res?.additional_caller_phones)) setCachedAdditionalPhones(() => res.additional_caller_phones);
      else setCachedAdditionalPhones((phones) => [...phones, { phone: vars.phone }]);
      qc.invalidateQueries({ queryKey: ["system", id] });
      toast.success("נוסף מספר פונה");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const updPhoneMut = useMutation({
    mutationFn: (v: { systemId: string; index: number; phone: string }) => updPhoneFn({ data: v }),
    onSuccess: (_res, vars) => {
      setCachedAdditionalPhones((phones) => phones.map((entry, i) => i === vars.index ? { ...entry, phone: vars.phone } : entry));
      qc.invalidateQueries({ queryKey: ["system", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const rmPhoneMut = useMutation({
    mutationFn: (v: { systemId: string; index: number }) => rmPhoneFn({ data: v }),
    onSuccess: (_res, vars) => {
      setCachedAdditionalPhones((phones) => phones.filter((_entry, i) => i !== vars.index));
      qc.invalidateQueries({ queryKey: ["system", id] });
      toast.success("המספר הוסר");
    },
    onError: (e: any) => toast.error(e.message),
  });

  useEffect(() => {
    const ids: string[] = (data?.system as any)?.reminder_agent_ids ?? [];
    setReminderAgentIds(ids);
    setReminderScope(ids.length === 0 ? "all" : "specific");
  }, [data?.system?.id]);

  const mentionOptions = useMemo(() => [
    { id: "__all", label: "כולם", token: "@כולם" },
    ...(agents ?? []).map((a: any) => ({ id: a.id, label: a.display_name, token: `@${a.display_name}` })),
  ], [agents]);
  function applyMention(token: string) {
    setNoteText((prev) => {
      const at = prev.lastIndexOf("@");
      const base = at >= 0 ? prev.slice(0, at) : prev;
      const suffix = prev.endsWith(" ") ? "" : " ";
      return `${base}${token}${suffix}`;
    });
    setMentionOpen(false);
  }

  if (isLoading || !data) return <div className="text-center py-20 text-muted-foreground">טוען...</div>;
  const s = data.system;
  const isSub = !!s.parent_system_id;
  
  const currentStatusSetting = (statusSettings as any[] | undefined)?.find((r) => r.status_key === s.status);
  const voiceEnabled = !!currentStatusSetting?.enables_voice_message;
  const voiceAlreadySent = !!s.voice_message_sent_at;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="h-4 w-4" />חזרה לדשבורד
      </Link>

      {me?.userId && (
        <SystemPresence
          systemId={id}
          userId={me.userId}
          displayName={(me as any).displayName ?? "נציג"}
        />
      )}


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

      {(() => {
        const cardTone = statusCardClasses(s.status);
        const accentBorder = cardTone.split(" ").find((c) => /^border-[a-z]+-\d+$/.test(c)) ?? "border-border";
        const btnBase = "inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md transition";
        const iconBtn = "inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition";
        return (
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-stretch">
              {/* Title zone with status accent on the right (RTL start) */}
              <div className={`flex-1 min-w-0 border-r-4 ${accentBorder} p-5`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] rounded-full px-2.5 py-0.5 font-medium ${toneClasses(STATUS_TONE[s.status as SystemStatus])}`}>
                    {STATUS_LABEL[s.status as SystemStatus]}
                  </span>
                  {isSub && <span className="text-[11px] bg-amber-50 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5 font-medium">תת-מערכת</span>}
                  {(me?.isSuperAdmin || (me as any)?.permissions?.system_code_edit) ? (
                    <input
                      defaultValue={s.system_code || ""}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== (s.system_code || "")) updateMut.mutate({ data: { id, system_code: v } }); }}
                      className="text-xs font-mono text-muted-foreground bg-muted/40 rounded px-2 py-0.5 border border-border w-36 focus:outline-none focus:border-primary"
                      title="מזהה מערכת"
                    />
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground bg-muted/40 rounded px-2 py-0.5">{s.system_code}</span>
                  )}
                </div>
                {(me?.isSuperAdmin || (me as any)?.permissions?.system_name_edit) ? (
                  <input
                    defaultValue={s.name || ""}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) updateMut.mutate({ data: { id, name: v } }); }}
                    className="text-2xl md:text-3xl font-bold tracking-tight mt-2 bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none w-full"
                  />
                ) : (
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-2 truncate">{s.name}</h1>
                )}
                <div className="mt-2 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground">
                  <span>נציג: <span className="font-medium text-foreground">{s.agent_name || "לא משויך"}</span></span>
                  {s.created_at && (
                    <span>
                      נפתחה: <span className="font-medium text-foreground">{new Date(s.created_at).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Actions zone */}
              <div className="p-5 lg:border-r lg:border-border bg-muted/20 flex flex-wrap gap-2 lg:min-w-[320px] lg:justify-end items-start content-start">
                {s.system_code && (
                  <div className="inline-flex items-stretch rounded-md border border-border overflow-hidden shadow-sm">
                    <a href={`tel:${buildDialNumber(s.system_code)}`}
                      className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                      <Phone className="h-3.5 w-3.5" />
                      <span>חיוג מערכת</span>
                    </a>
                    <button onClick={() => copyToClipboard(s.system_code, "code", "מזהה המערכת")}
                      title="העתק מזהה מערכת"
                      className="inline-flex items-center justify-center h-9 w-9 bg-background hover:bg-accent text-muted-foreground border-r border-border">
                      {copiedKey === "code" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
                {s.caller_phone && (
                  <div className="inline-flex items-stretch rounded-md border border-border overflow-hidden shadow-sm">
                    <a href={`tel:${buildDialNumber(s.caller_phone)}`}
                      className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium bg-sky-600 text-white hover:bg-sky-700">
                      <Phone className="h-3.5 w-3.5" />
                      <span>חיוג פונה</span>
                    </a>
                    <button onClick={() => copyToClipboard(s.caller_phone!, "caller", "מספר הפונה")}
                      title="העתק מספר פונה"
                      className="inline-flex items-center justify-center h-9 w-9 bg-background hover:bg-accent text-muted-foreground border-r border-border">
                      {copiedKey === "caller" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      disabled={!voiceEnabled || voiceMut.isPending}
                      onClick={() => {
                        const confirmMsg = voiceAlreadySent
                          ? "ההודעה כבר נשלחה בעבר. לשלוח שוב?"
                          : "לשלוח הודעה קולית לפונה כעת?";
                        if (!window.confirm(confirmMsg)) return;
                        voiceMut.mutate({ systemId: id, phoneIndex: -1 });
                      }}
                      title={
                        !voiceEnabled
                          ? "לא ניתן לשלוח הודעה בסטטוס זה"
                          : voiceAlreadySent
                            ? `נשלח: ${new Date(s.voice_message_sent_at as string).toLocaleString("he-IL")}`
                            : "שליחת הודעה קולית לפונה דרך ימות המשיח"
                      }
                      aria-label="שלח הודעה קולית"
                      className={`inline-flex items-center justify-center h-9 w-9 border-r border-border transition ${
                        !voiceEnabled
                          ? "bg-background text-muted-foreground/40 cursor-not-allowed"
                          : voiceAlreadySent
                            ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100"
                      }`}>
                      {voiceMut.isPending
                        ? <span className="inline-block h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
                {s.phone && (
                  <a href={`tel:${s.phone}`}
                    className={`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm`}>
                    <Phone className="h-3.5 w-3.5" />
                    חיוג {s.phone}
                  </a>
                )}
                {me?.isSuperAdmin && (
                  <button onClick={() => {
                    const childCount = data.children?.length ?? 0;
                    if (childCount === 0) {
                      if (confirm("למחוק מערכת זו?")) deleteMut.mutate({ data: { id } });
                      return;
                    }
                    const choice = window.prompt(
                      `למערכת זו יש ${childCount} תתי-מערכות.\n\n` +
                      `הקלד "הכל" כדי למחוק את המערכת ואת כל תתי-המערכות.\n` +
                      `הקלד "קדם" כדי למחוק רק את המערכת הראשית — תת-מערכת אחת תהפוך לראשית ותכלול את השאר.\n` +
                      `השאר ריק כדי לבטל.`,
                      "",
                    )?.trim();
                    if (choice === "הכל") {
                      deleteMut.mutate({ data: { id, mode: "cascade" } });
                    } else if (choice === "קדם") {
                      deleteMut.mutate({ data: { id, mode: "promote" } });
                    }
                  }}
                    title="מחק מערכת"
                    aria-label="מחק מערכת"
                    className={`${iconBtn} hover:!text-destructive hover:!bg-destructive/10 hover:!border-destructive/30`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== פרטים ===== */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold flex items-center gap-2 mb-4"><Info className="h-4 w-4" />פרטים</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium block mb-2">סטטוס</label>
            <select value={s.status} onChange={(e) => {
              const newStatus = e.target.value;
              if (newStatus === s.status) return;
              const isRootWithChildren = !s.parent_system_id && (data?.children?.length ?? 0) > 0;
              let apply_to_children: boolean | undefined;
              if (isRootWithChildren) {
                apply_to_children = window.confirm(
                  `להחיל את שינוי הסטטוס גם על ${data!.children.length} תתי-המערכות?\n\nאישור = לשנות גם את התתי-מערכת\nביטול = לשנות רק את המערכת הראשית`
                );
              }
              if (!statusRequiresReason(newStatus)) {
                updateMut.mutate({ data: { id, status: newStatus, ...(apply_to_children !== undefined ? { apply_to_children } : {}) } });
                return;
              }
              const reason = window.prompt("סיבת שינוי הסטטוס (חובה):", "");
              if (!reason || !reason.trim()) { toast.error("יש להזין סיבה"); return; }
              updateMut.mutate({ data: { id, status: newStatus, reason: reason.trim(), ...(apply_to_children !== undefined ? { apply_to_children } : {}) } });
            }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground">
              {STATUS_OPTIONS.filter((o) => STATUS_MANDATORY[o.value] !== false).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">סטטוס משני (אופציונלי)</label>
            <select
              value={s.secondary_status || ""}
              onChange={(e) => updateMut.mutate({ data: { id, secondary_status: e.target.value || null } })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground">
              <option value="">— ללא —</option>
              {STATUS_OPTIONS.filter((o) => STATUS_MANDATORY[o.value] === false).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">מוצג רק בכרטיס המערכת, לא בדשבורד.</p>
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
          <div className="md:col-span-2">
            <CallerPhonesEditor
              systemId={id}
              primary={s.caller_phone || ""}
              primarySentAt={(s as any).voice_message_sent_at || null}
              additional={((s as any).additional_caller_phones ?? []) as Array<{ phone: string; sent_at?: string }>}
              voiceEnabled={voiceEnabled}
              onSavePrimary={(v: string) => updateMut.mutate({ data: { id, caller_phone: v || null } })}
              onSendPrimary={() => voiceMut.mutate({ systemId: id, phoneIndex: -1 })}
              onAddAdditional={(phone: string) => addPhoneMut.mutate({ systemId: id, phone })}
              onUpdateAdditional={(index: number, phone: string) => updPhoneMut.mutate({ systemId: id, index, phone })}
              onRemoveAdditional={(index: number) => rmPhoneMut.mutate({ systemId: id, index })}
              onSendAdditional={(index: number) => voiceMut.mutate({ systemId: id, phoneIndex: index })}
              sending={voiceMut.isPending}
            />
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
                  <ParentPicker
                    mains={mains ?? []}
                    excludeId={id}
                    value={parentChoice}
                    onChange={setParentChoice}
                    onConfirm={() => parentMut.mutate({ data: { id, parent_system_id: parentChoice } })}
                    onCancel={() => setShowParentPick(false)}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ===== מעקב — תזכורות ===== */}
        <ReminderSection
          hasReminder={!!s.reminder_at}
          headerSummary={
            s.reminder_at ? (
              <span>
                תזכורת מתוכננת ל-<strong>{new Date(s.reminder_at).toLocaleString("he-IL")}</strong>
                {((s as any).reminder_agent_ids?.length ?? 0) > 0 && (
                  <span className="opacity-80"> · עבור: {((s as any).reminder_agent_ids as string[]).map((aid) => (agents ?? []).find((a: any) => a.id === aid)?.display_name).filter(Boolean).join(", ")}</span>
                )}
              </span>
            ) : (
              <span className="opacity-70">אין תזכורת מוגדרת</span>
            )
          }
        >
          <div className="space-y-3">
            <div className="flex items-center justify-end gap-1 flex-wrap">
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
        </ReminderSection>


        {/* ===== הערות + יומן שינויים זה לצד זה ===== */}
        <div className="mt-8 pt-6 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* הערות */}
          <div>
            <h2 className="font-semibold flex items-center gap-2 mb-4"><MessageSquare className="h-4 w-4" />הערות ({data.notes.length})</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) noteMut.mutate({ data: { system_id: id, body: noteText.trim() } }); }}
              className="flex gap-2 mb-4 relative">
              <div className="relative flex-1">
                <input value={noteText} onChange={(e) => { setNoteText(e.target.value); setMentionOpen(e.target.value.includes("@")); }} onFocus={() => { if (noteText.includes("@")) setMentionOpen(true); }} placeholder="הוסף הערה..."
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                {mentionOpen && (
                  <div className="absolute right-0 left-0 top-full mt-1 z-20 max-h-56 overflow-auto rounded-lg border border-border bg-popover shadow-lg">
                    {mentionOptions.map((opt) => (
                      <button key={opt.id} type="button" onClick={() => applyMention(opt.token)}
                        className="w-full text-right px-3 py-2 text-sm hover:bg-accent flex items-center gap-2">
                        <span className="text-primary">@</span>{opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                  const oldDisp = a.field === "assigned_agent_id"
                    ? (a.old_agent_name || formatValue(a.field, a.old_value))
                    : a.field === "parent_system_id"
                      ? (a.old_value ? (a.old_parent_name || formatValue(a.field, a.old_value)) : "ללא מערכת אב")
                      : formatValue(a.field, a.old_value);
                  const newDisp = a.field === "assigned_agent_id"
                    ? (a.new_agent_name || formatValue(a.field, a.new_value))
                    : a.field === "parent_system_id"
                      ? (a.new_value ? (a.new_parent_name || formatValue(a.field, a.new_value)) : "ללא מערכת אב")
                      : formatValue(a.field, a.new_value);
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
            בשינוי סטטוס של מערכת ראשית תישאל האם להחיל את השינוי גם על תתי-המערכות. שינוי נציג עדיין עובר אליהן אוטומטית.
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

/**
 * Searchable parent-system picker: lets the admin type part of an existing
 * system's name or code and pick from a filtered list, instead of scrolling
 * through a long static <select>.
 */
function ParentPicker({
  mains, excludeId, value, onChange, onConfirm, onCancel,
}: {
  mains: Array<{ id: string; system_code: string; name: string }>;
  excludeId: string;
  value: string;
  onChange: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = (mains ?? []).filter((m) => m.id !== excludeId);
    if (!q) return base.slice(0, 50);
    return base
      .filter((m) =>
        (m.name || "").toLowerCase().includes(q) ||
        (m.system_code || "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [mains, excludeId, query]);
  const selected = (mains ?? []).find((m) => m.id === value) ?? null;

  return (
    <div className="flex flex-col gap-2 w-full max-w-md p-2 border border-input rounded-md bg-background">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="חפש מערכת אב לפי שם או מספר…"
        className="text-xs rounded-md border border-input bg-background px-2 py-1.5"
      />
      <div className="max-h-48 overflow-y-auto rounded-md border border-border">
        {candidates.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-3">לא נמצאו תוצאות</div>
        )}
        {candidates.map((m: { id: string; system_code: string; name: string }) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`w-full text-right px-2 py-1.5 text-xs hover:bg-accent ${value === m.id ? "bg-accent font-semibold" : ""}`}
          >
            <span className="font-mono">{m.system_code}</span> · {m.name}
          </button>
        ))}
      </div>
      {selected && (
        <div className="text-xs text-muted-foreground">
          נבחר: <span className="font-medium text-foreground">{selected.system_code} · {selected.name}</span>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <button
          disabled={!value}
          onClick={onConfirm}
          className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
        >אשר</button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 border border-input rounded-md"
        >ביטול</button>
      </div>
    </div>
  );
}

function CallerPhoneRow({
  initial, sentAt, voiceEnabled, sending, onSave, onSend, onRemove, showRemove,
}: {
  initial: string;
  sentAt: string | null | undefined;
  voiceEnabled: boolean;
  sending: boolean;
  onSave: (v: string) => void;
  onSend: () => void;
  onRemove?: () => void;
  showRemove: boolean;
}) {
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal(initial); }, [initial]);
  const digits = (val || "").replace(/\D/g, "");
  const sendTitle = !voiceEnabled
    ? "לא ניתן לשלוח הודעה בסטטוס זה"
    : sentAt ? `נשלח: ${new Date(sentAt).toLocaleString("he-IL")}` : "שליחת הודעה קולית לפונה";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { if (val.trim() !== (initial || "").trim()) onSave(val.trim()); }}
          placeholder="מספר טלפון של הפונה"
          className="flex-1 min-w-[160px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
        {digits && (
          <a href={`tel:${digits}`}
            title="חייג"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-sky-600 text-white hover:bg-sky-700">
            <Phone className="h-4 w-4" />
          </a>
        )}
        {digits && (
          <button type="button"
            onClick={() => navigator.clipboard.writeText(digits).then(() => toast.success("המספר הועתק"))}
            title="העתק"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background text-muted-foreground hover:bg-accent">
            <Copy className="h-4 w-4" />
          </button>
        )}
        <button type="button"
          disabled={!voiceEnabled || sending || !digits}
          onClick={() => { if (window.confirm(sentAt ? "ההודעה כבר נשלחה בעבר. לשלוח שוב?" : "לשלוח הודעה קולית לפונה כעת?")) onSend(); }}
          title={sendTitle}
          aria-label="שלח הודעה קולית"
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium border transition ${
            !voiceEnabled
              ? "bg-background text-muted-foreground/50 border-border cursor-not-allowed"
              : sentAt
                ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                : "bg-fuchsia-600 text-white border-fuchsia-600 hover:bg-fuchsia-700"
          }`}>
          <Volume2 className="h-3.5 w-3.5" />
          <span>שלח הודעה</span>
        </button>
        {showRemove && onRemove && (
          <button type="button" onClick={() => { if (window.confirm("להסיר מספר פונה זה?")) onRemove(); }}
            title="הסר מספר"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {sentAt ? (
        <div className="text-[11px] text-emerald-700 pr-1">
          ✓ הודעה נשלחה בתאריך {new Date(sentAt).toLocaleString("he-IL")}
        </div>
      ) : null}
    </div>
  );
}

function CallerPhonesEditor({
  primary, primarySentAt, additional, voiceEnabled, sending,
  onSavePrimary, onSendPrimary, onAddAdditional, onUpdateAdditional, onRemoveAdditional, onSendAdditional,
}: {
  systemId: string;
  primary: string;
  primarySentAt: string | null;
  additional: Array<{ phone: string; sent_at?: string }>;
  voiceEnabled: boolean;
  sending: boolean;
  onSavePrimary: (v: string) => void;
  onSendPrimary: () => void;
  onAddAdditional: (phone: string) => void;
  onUpdateAdditional: (index: number, phone: string) => void;
  onRemoveAdditional: (index: number) => void;
  onSendAdditional: (index: number) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium">מספר פונה</label>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-input bg-background hover:bg-accent text-foreground"
          title="הוסף מספר פונה נוסף">
          <Plus className="h-3.5 w-3.5" /> הוסף מספר פונה
        </button>
      </div>
      <div className="space-y-2">
        <CallerPhoneRow
          initial={primary}
          sentAt={primarySentAt}
          voiceEnabled={voiceEnabled}
          sending={sending}
          onSave={onSavePrimary}
          onSend={onSendPrimary}
          showRemove={false}
        />
        {additional.map((entry, i) => (
          <CallerPhoneRow
            key={i}
            initial={entry.phone || ""}
            sentAt={entry.sent_at ?? null}
            voiceEnabled={voiceEnabled}
            sending={sending}
            onSave={(v) => onUpdateAdditional(i, v)}
            onSend={() => onSendAdditional(i)}
            onRemove={() => onRemoveAdditional(i)}
            showRemove={true}
          />
        ))}
      </div>
      {showAdd && (
        <div className="mt-2 flex items-center gap-2 p-2 border border-dashed border-input rounded-lg bg-muted/20">
          <input
            autoFocus
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPhone.trim()) {
                e.preventDefault();
                onAddAdditional(newPhone.trim());
                setNewPhone("");
                setShowAdd(false);
              } else if (e.key === "Escape") {
                setShowAdd(false); setNewPhone("");
              }
            }}
            placeholder="מספר טלפון חדש (Enter לשמירה)"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button type="button"
            disabled={!newPhone.trim()}
            onClick={() => { onAddAdditional(newPhone.trim()); setNewPhone(""); setShowAdd(false); }}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
            הוסף
          </button>
          <button type="button" onClick={() => { setShowAdd(false); setNewPhone(""); }}
            className="px-3 py-2 rounded-md border border-input text-xs">
            ביטול
          </button>
        </div>
      )}
    </div>
  );
}



