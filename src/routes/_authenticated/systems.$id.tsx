import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSystem, listAgents, listMainSystems,
  updateSystem, addNote, deleteSystem, addSubSystem,
  setReminder, dismissReminder, setParent, sendVoiceMessage,
  addAdditionalCallerPhone, updateAdditionalCallerPhone, removeAdditionalCallerPhone,
  updateNote, deleteNote, updateActivityLog, deleteActivityLog, listSystemActivity,
} from "@/lib/systems.functions";

import { getMyRole, listStatusSettings } from "@/lib/admin.functions";
import { listSystemEmailThread, sendSystemEmail, listEmailTemplates, getEmailGeneralName } from "@/lib/email.functions";
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
  Paperclip, Upload, Download, FileText, ChevronDown, Copy, Check, Volume2, X, Mail, ExternalLink, Pencil,
} from "lucide-react";

import { useNavigate } from "@tanstack/react-router";
import { SystemPresence } from "@/components/SystemPresence";
import { EmailContentEditor } from "@/components/EmailContentEditor";
import type { EmailCleanupLevel } from "@/lib/email-cleanup";


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
  manager_phone: "מספר מנהל",
  caller_phone: "מספר פונה",
  reminder_at: "תזכורת",
  parent_system_id: "מערכת אב",
};

type WorkTab = "emails" | "subs" | "files" | "reminders";
const WORK_TABS: Array<{ key: WorkTab; label: string }> = [
  { key: "emails", label: "מיילים" },
  { key: "subs", label: "תתי-מערכות" },
  { key: "files", label: "קבצים" },
  { key: "reminders", label: "תזכורות" },
];

function SystemDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showSendChoice, setShowSendChoice] = useState(false);
  const [sendChoicePos, setSendChoicePos] = useState<{ top: number; left: number } | null>(null);
  const sendChoiceBtnRef = useRef<HTMLButtonElement>(null);
  const [showSendPicker, setShowSendPicker] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  // "תתי-מערכות" is the tab a card opens on; the choice is not remembered
  // between systems so every card starts from the same known place.
  const [tab, setTab] = useState<WorkTab>("subs");
  function selectTab(next: WorkTab) {
    setTab(next);
  }




  function copyToClipboard(value: string, key: string, label: string) {
    navigator.clipboard.writeText(value)
      .then(() => {
        toast.success(`${label} הועתק`);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      })
      .catch(() => toast.error("ההעתקה נכשלה"));
  }

  // פותח מערכת אחרת בחלון חדש חצי-רוחב מימין, וממקם את החלון הנוכחי
  // לחצי השמאלי, כדי לקבל "פרישה במקביל" של אב↔תת-מערכת.
  function openSideBySide(path: string) {
    try {
      const sw = window.screen.availWidth || window.innerWidth;
      const sh = window.screen.availHeight || window.innerHeight;
      const sx = (window.screen as any).availLeft ?? 0;
      const sy = (window.screen as any).availTop ?? 0;
      const half = Math.floor(sw / 2);
      const feats = `left=${sx + half},top=${sy},width=${half},height=${sh}`;
      const w = window.open(path, `sysCompare_${path}`, feats);
      if (!w) { window.open(path, "_blank"); return; }
      try { window.moveTo(sx, sy); window.resizeTo(half, sh); } catch { /* חסום ע"י דפדפן — ניתן להתעלם */ }
      w.focus();
    } catch {
      window.open(path, "_blank");
    }
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
  const activityFn = useServerFn(listSystemActivity);

  const { data, isLoading } = useQuery({ queryKey: ["system", id], queryFn: () => getFn({ data: { id } }) });
  // Reference/settings data changes rarely — cache it longer than the 30s
  // default so opening a system card and returning to the dashboard (which
  // reads the same query keys) doesn't re-fetch it every time.
  const REFERENCE_STALE_TIME = 5 * 60_000;
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn(), staleTime: REFERENCE_STALE_TIME });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({}), staleTime: REFERENCE_STALE_TIME });
  const { data: mains } = useQuery({ queryKey: ["mainSystems"], queryFn: () => mainsFn(), staleTime: REFERENCE_STALE_TIME });
  const { data: statusSettings } = useQuery({ queryKey: ["status_settings"], queryFn: () => statusSettingsFn(), staleTime: REFERENCE_STALE_TIME });
  const noteEditorRef = useRef<HTMLDivElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  // Older activity pages loaded on demand ("טען עוד") + activity filters.
  const [olderActivity, setOlderActivity] = useState<any[]>([]);
  const [activityHasMore, setActivityHasMore] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityActionFilter, setActivityActionFilter] = useState<string>("");
  const [activityActorFilter, setActivityActorFilter] = useState<string>("");
  const [activityFrom, setActivityFrom] = useState<string>("");
  const [activityTo, setActivityTo] = useState<string>("");
  useEffect(() => {
    setOlderActivity([]);
    setActivityHasMore(true);
  }, [id, activityActionFilter, activityActorFilter, activityFrom, activityTo]);
  const loadMoreActivity = async (baseCount: number) => {
    setActivityLoading(true);
    try {
      const res: any = await activityFn({
        data: {
          systemId: id,
          offset: baseCount + olderActivity.length,
          action: activityActionFilter || null,
          actorId: activityActorFilter || null,
          from: activityFrom || null,
          to: activityTo || null,
        },
      });
      setOlderActivity((prev) => [...prev, ...(res?.items ?? [])]);
      setActivityHasMore(!!res?.hasMore);
    } catch (e: any) {
      toast.error(e?.message ?? "טעינת היומן נכשלה");
    } finally {
      setActivityLoading(false);
    }
  };
  // Per-user preference for whether the "פרטים" section starts expanded.
  const [detailsDefaultOpen, setDetailsDefaultOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("crm.details.defaultOpen");
    return v === null ? true : v === "1";
  });
  const [detailsOpen, setDetailsOpen] = useState<boolean>(detailsDefaultOpen);

  const [subCode, setSubCode] = useState("");
  const [subName, setSubName] = useState("");
  const [customDate, setCustomDate] = useState<string>("");
  const [showParentPick, setShowParentPick] = useState(false);
  const [parentChoice, setParentChoice] = useState<string>("");
  const [reminderAgentIds, setReminderAgentIds] = useState<string[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
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
  const emailThreadFn = useServerFn(listSystemEmailThread);
  const sendEmailFn = useServerFn(sendSystemEmail);
  const emailTemplatesFn = useServerFn(listEmailTemplates);
  const { data: emailThread } = useQuery({
    queryKey: ["system-email-thread", id],
    queryFn: () => emailThreadFn({ data: { system_id: id } }),
  });
  const { data: emailTemplates } = useQuery({
    queryKey: ["email_templates"],
    queryFn: async () => emailTemplatesFn({}),
  });
  const emailGeneralNameFn = useServerFn(getEmailGeneralName);
  const { data: emailGeneralName } = useQuery({
    queryKey: ["email_general_name"],
    queryFn: async () => emailGeneralNameFn({}),
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"new" | "reply" | "forward">("new");
  const [composeThreadId, setComposeThreadId] = useState<string | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeUseGeneral, setComposeUseGeneral] = useState(false);
  const [emailCleanupLevel, setEmailCleanupLevel] = useState<EmailCleanupLevel>("standard");
  // Inline quick-reply state (avoids opening a modal for a fast response)
  const [inlineReplyFor, setInlineReplyFor] = useState<string | null>(null);
  const [inlineReplyText, setInlineReplyText] = useState("");
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const sendEmailMut = useMutation({
    mutationFn: (v: { to: string; subject: string; body: string; gmail_thread_id?: string | null; use_general_name?: boolean; cleanup_level?: EmailCleanupLevel }) =>
      sendEmailFn({ data: { system_id: id, ...v, cleanup_level: v.cleanup_level ?? emailCleanupLevel } }),
    onSuccess: () => {
      toast.success("המייל נשלח");
      qc.invalidateQueries({ queryKey: ["system-email-thread", id] });
      setComposeOpen(false); setComposeSubject(""); setComposeBody("");
    },
    onError: (e: any) => toast.error(e.message ?? "שליחת המייל נכשלה"),
  });
  function applyTemplate(t: { subject: string; body: string }) {
    const fill = (text: string) => text
      .replace(/\{\{system_code\}\}/g, s.system_code ?? "")
      .replace(/\{\{system_name\}\}/g, s.name ?? "")
      .replace(/\{\{caller_phone\}\}/g, s.caller_phone ?? "")
      .replace(/\{\{agent_name\}\}/g, me?.displayName ?? "");
    setComposeSubject(fill(t.subject));
    setComposeBody(fill(t.body));
  }
  function extractEmail(raw: string): string {
    const m = raw.match(/<([^>]+)>/);
    return (m ? m[1] : raw).trim();
  }
  function openNewEmail() {
    setComposeMode("new"); setComposeThreadId(null);
    setComposeTo((s as any).email || ""); setComposeSubject(""); setComposeBody(""); setComposeUseGeneral(false);
    setComposeOpen(true);
  }
  function openReplyEmail(m: any) {
    const other = m.direction === "outbound" ? (m.to_address || "") : extractEmail(m.from_address || "");
    setComposeMode("reply"); setComposeThreadId(m.gmail_thread_id ?? null);
    setComposeTo(other);
    setComposeSubject(m.subject ? (m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`) : "Re: ");
    setComposeBody(""); setComposeUseGeneral(false);
    setComposeOpen(true);
  }
  function openForwardEmail(m: any) {
    setComposeMode("forward"); setComposeThreadId(null);
    setComposeTo("");
    setComposeSubject(m.subject ? (m.subject.startsWith("Fwd:") ? m.subject : `Fwd: ${m.subject}`) : "Fwd: ");
    const who = m.direction === "outbound" ? (m.agent_name || "") : (m.from_address || "");
    setComposeBody(`\n\n---------- הודעה מקורית ----------\nמאת: ${who}\n${new Date(m.created_at).toLocaleString("he-IL")}\n\n${m.body ?? ""}`);
    setComposeUseGeneral(false);
    setComposeOpen(true);
  }
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
    // Optimistic update: patch the cached system card immediately so status
    // changes (and other field edits) reflect in the UI right away instead
    // of waiting for the full round trip + refetch. Rolled back on error.
    onMutate: async (vars: any) => {
      await qc.cancelQueries({ queryKey: ["system", id] });
      const patch = vars?.data ?? {};
      const previous = qc.getQueryData(["system", id]);
      qc.setQueryData(["system", id], (old: any) => {
        if (!old?.system) return old;
        return { ...old, system: { ...old.system, ...patch } };
      });
      return { previous };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(["system", id], ctx.previous);
      toast.error(e.message);
    },
    onSuccess: () => { toast.success("עודכן"); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["system", id] });
      qc.invalidateQueries({ queryKey: ["systems"] });
    },
  });
  const noteMut = useMutation({
    mutationFn: noteFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system", id] });
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
      if (noteEditorRef.current) noteEditorRef.current.innerHTML = "";
      setMentionQuery(null);
      toast.success("ההערה נוספה");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const updateNoteFn = useServerFn(updateNote);
  const deleteNoteFn = useServerFn(deleteNote);
  const updateActivityFn = useServerFn(updateActivityLog);
  const deleteActivityFn = useServerFn(deleteActivityLog);
  const editNoteMut = useMutation({
    mutationFn: updateNoteFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("ההערה עודכנה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const removeNoteMut = useMutation({
    mutationFn: deleteNoteFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("ההערה נמחקה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const editActivityMut = useMutation({
    mutationFn: updateActivityFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("השורה עודכנה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const removeActivityMut = useMutation({
    mutationFn: deleteActivityFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("השורה נמחקה"); },
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
  const suppressVoiceToastRef = useRef(false);
  const voiceMut = useMutation({
    mutationFn: (v: { systemId: string; phoneIndex?: number }) => voiceFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system", id] });
      if (!suppressVoiceToastRef.current) toast.success("ההודעה הקולית נשלחה בהצלחה");
    },
    onError: (e: any) => { if (!suppressVoiceToastRef.current) toast.error(e.message ?? "שליחת ההודעה נכשלה"); },
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

  // Ask about an existing reminder only when ENTERING a system that already
  // has one — never right after the user sets a reminder here. The effect is
  // keyed on the system id alone, so later reminder changes never re-open it.
  const [askCancelReminder, setAskCancelReminder] = useState(false);
  const [cancelAgentIds, setCancelAgentIds] = useState<string[]>([]);
  const askedSystemRef = useRef<string | null>(null);
  useEffect(() => {
    const sys: any = data?.system;
    if (!sys?.id) return;
    if (askedSystemRef.current === sys.id) return;
    askedSystemRef.current = sys.id;
    setCancelAgentIds([]);
    if (sys.reminder_at) setAskCancelReminder(true);
  }, [data?.system?.id]);


  const allMentionOptions = useMemo(() => [
    { id: "__all", label: "כולם" },
    ...(agents ?? []).map((a: any) => ({ id: a.id as string, label: a.display_name as string })),
  ], [agents]);
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.trim();
    if (!q) return allMentionOptions;
    return allMentionOptions.filter((o) => o.label && o.label.toLowerCase().startsWith(q.toLowerCase()));
  }, [allMentionOptions, mentionQuery]);

  // Insert a mention chip at the current caret, replacing the `@query` typed so far.
  function insertMention(name: string) {
    const editor = noteEditorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return;
    const text = node.textContent ?? "";
    const at = text.slice(0, range.startOffset).lastIndexOf("@");
    if (at < 0) return;

    // Remove the "@query" segment from the text node, then insert a chip + space.
    (node as Text).deleteData(at, range.startOffset - at);

    const chip = document.createElement("span");
    chip.setAttribute("data-mention", name);
    chip.setAttribute("contenteditable", "false");
    chip.className = "inline-flex items-center gap-0.5 align-baseline mx-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary select-none";
    chip.textContent = `@${name}`;

    const space = document.createTextNode("\u00A0");
    const rest = (node as Text).splitText(at);
    const parent = node.parentNode!;
    parent.insertBefore(chip, rest);
    parent.insertBefore(space, rest);

    const r = document.createRange();
    r.setStart(space, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    setMentionQuery(null);
    setMentionActiveIndex(0);
  }

  function serializeNote(): string {
    const editor = noteEditorRef.current;
    if (!editor) return "";
    let out = "";
    const walk = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += (n.textContent ?? "").replace(/\u00A0/g, " ");
      } else if (n instanceof HTMLElement) {
        const m = n.getAttribute("data-mention");
        if (m) { out += `@${m}`; return; }
        if (n.tagName === "BR") { out += "\n"; return; }
        n.childNodes.forEach(walk);
      }
    };
    editor.childNodes.forEach(walk);
    return out.trim();
  }

  function handleNoteInput() {
    const sel = window.getSelection();
    const editor = noteEditorRef.current;
    if (!sel || !editor || sel.rangeCount === 0) { setMentionQuery(null); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) { setMentionQuery(null); return; }
    const before = (node.textContent ?? "").slice(0, range.startOffset);
    const at = before.lastIndexOf("@");
    if (at < 0) { setMentionQuery(null); return; }
    const after = before.slice(at + 1);
    if (/\s/.test(after) || after.length > 30) { setMentionQuery(null); return; }
    setMentionQuery(after);
    setMentionActiveIndex(0);
  }

  // Known mention names (agents + "כולם"), longest first for greedy matching.
  const mentionNames = useMemo(() => {
    const names = ["כולם", ...((agents ?? []) as any[]).map((a) => a.display_name)].filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => b.length - a.length);
  }, [agents]);

  // Parse note body and render `@name` mentions as clickable chip pills.
  function renderNoteBody(body: string) {
    if (!body) return null;
    const nodes: ReactNode[] = [];
    let i = 0;
    let key = 0;
    while (i < body.length) {
      const at = body.indexOf("@", i);
      if (at === -1) { nodes.push(body.slice(i)); break; }
      if (at > i) nodes.push(body.slice(i, at));
      let matched: string | null = null;
      for (const name of mentionNames) {
        if (body.startsWith(name, at + 1)) { matched = name; break; }
      }
      if (matched) {
        const label = matched;
        const isActive = mentionFilter === label;
        nodes.push(
          <button key={`m-${key++}`} type="button"
            onClick={() => setMentionFilter((cur) => (cur === label ? null : label))}
            className={`inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium transition ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "bg-primary/10 text-primary hover:bg-primary/20"}`}
            title={`סנן פעילות עם @${label}`}>
            <span>@</span>{label}
          </button>,
        );
        i = at + 1 + label.length;
      } else {
        nodes.push("@");
        i = at + 1;
      }
    }
    return nodes;
  }

  if (isLoading || !data) return <div className="text-center py-20 text-muted-foreground">טוען...</div>;
  const s = data.system;

  const isSub = !!s.parent_system_id;

  // TanStack reuses this component when only :id changes. Wait for the loaded
  // record's type as well: during navigation the previous child record can
  // remain briefly in the query placeholder and must not force its parent to
  // inherit the "emails" tab.
  useEffect(() => {
    setTab(isSub ? "emails" : "subs");
  }, [id, isSub]);

  
  const currentStatusSetting = (statusSettings as any[] | undefined)?.find((r) => r.status_key === s.status);
  const voiceEnabled = !!currentStatusSetting?.enables_voice_message;
  const voiceAlreadySent = !!s.voice_message_sent_at;

  // All recipients for the "send voice message" top button: primary caller
  // phone (index -1) plus every additional caller phone (index 0..N-1).
  const additionalPhones: Array<{ phone: string; sent_at?: string }> = Array.isArray((s as any).additional_caller_phones)
    ? (s as any).additional_caller_phones
    : [];
  const voiceRecipients: Array<{ index: number; phone: string; sentAt: string | null; label: string }> = [
    ...(s.caller_phone ? [{ index: -1, phone: s.caller_phone as string, sentAt: (s.voice_message_sent_at as string) || null, label: "פונה ראשי" }] : []),
    ...additionalPhones
      .map((p, i) => ({ index: i, phone: p.phone, sentAt: p.sent_at || null, label: `פונה נוסף ${i + 1}` }))
      .filter((p) => !!p.phone),
  ];
  const unsentRecipients = voiceRecipients.filter((r) => !r.sentAt);

  async function sendVoiceBatch(recipients: Array<{ index: number; phone: string }>) {
    if (recipients.length === 0) { toast.info("אין נמענים מתאימים לשליחה"); return; }
    setBatchSending(true);
    suppressVoiceToastRef.current = true;
    let ok = 0, fail = 0;
    try {
      for (const r of recipients) {
        try {
          await voiceMut.mutateAsync({ systemId: id, phoneIndex: r.index });
          ok++;
        } catch {
          fail++;
        }
      }
    } finally {
      setBatchSending(false);
      suppressVoiceToastRef.current = false;
    }
    if (fail > 0) toast.error(`נשלחו ${ok} הודעות, נכשלו ${fail}`);
    else toast.success(`נשלחו ${ok} הודעות בהצלחה`);
  }

  return (
    <div className={splitOpen && data.parent ? "flex gap-3 items-start w-full" : ""}>
    <div className={`grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px] ${splitOpen && data.parent ? "flex-1 min-w-0" : "max-w-[1600px] mx-auto"}`}>
      <Link to="/dashboard" className="xl:col-span-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowRight className="h-4 w-4" />חזרה לדשבורד
      </Link>


      {askCancelReminder && s?.reminder_at && (() => {
        const targetIds: string[] = (s as any).reminder_agent_ids ?? [];
        const targetAgents = (targetIds.length > 0
          ? (agents ?? []).filter((a: any) => targetIds.includes(a.id))
          : (agents ?? [])) as any[];
        const targetNames = targetIds
          .map((tid) => (agents ?? []).find((a: any) => a.id === tid)?.display_name)
          .filter(Boolean) as string[];
        return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAskCancelReminder(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <Bell className="h-5 w-5 text-amber-600" />
              <h2 className="text-lg font-semibold">למערכת יש תזכורת פעילה</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-1">
              תזכורת ל-<strong className="text-foreground">{new Date(s.reminder_at).toLocaleString("he-IL")}</strong>.
              האם לבטל אותה?
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              מוגדרת עבור: <span className="text-foreground">{targetNames.length > 0 ? targetNames.join(", ") : "כל הנציגים"}</span>
            </p>

            {targetAgents.length > 1 && (
              <div className="rounded-lg border border-border p-3 mb-3">
                <div className="text-xs font-medium mb-2">ביטול לנציגים מסוימים בלבד:</div>
                <div className="max-h-40 overflow-auto space-y-1">
                  {targetAgents.map((a: any) => {
                    const checked = cancelAgentIds.includes(a.id);
                    return (
                      <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={checked}
                          onChange={() => setCancelAgentIds((prev) => checked ? prev.filter((x) => x !== a.id) : [...prev, a.id])} />
                        <span>{a.display_name}</span>
                      </label>
                    );
                  })}
                </div>
                <button
                  disabled={cancelAgentIds.length === 0}
                  onClick={() => { dismissMut.mutate({ data: { system_id: id, scope: "agents", agent_ids: cancelAgentIds } }); setAskCancelReminder(false); }}
                  className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  בטל עבור {cancelAgentIds.length || ""} נבחרים
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2 mt-3">
              <button
                onClick={() => { dismissMut.mutate({ data: { system_id: id, scope: "all" } }); setAskCancelReminder(false); }}
                className="w-full rounded-lg bg-red-600 text-white px-3 py-2 text-sm font-medium hover:bg-red-700"
              >
                בטל את התזכורת לכולם
              </button>
              <button
                onClick={() => { dismissMut.mutate({ data: { system_id: id, scope: "me" } }); setAskCancelReminder(false); }}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                בטל רק עבורי ({me?.displayName || "המשתמש הנוכחי"})
              </button>
              <button
                onClick={() => setAskCancelReminder(false)}
                className="w-full rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                לא, השאר את התזכורת
              </button>
            </div>
          </div>
        </div>
        );
      })()}


      {me?.userId && (
        <SystemPresence
          systemId={id}
          userId={me.userId}
          displayName={(me as any).displayName ?? "נציג"}
        />
      )}


      {isSub && data.parent && (
        <div className={`xl:col-span-2 border-2 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap ${statusCardClasses(data.parent.status)}`}>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <CornerUpRight className="h-4 w-4" />
            <span>זוהי <strong>תת-מערכת</strong> של:</span>
            <Link to="/systems/$id" params={{ id: data.parent.id }}
              className="font-mono text-xs bg-white/60 rounded px-2 py-0.5 hover:bg-white">
              {data.parent.system_code}
            </Link>
            <Link to="/systems/$id" params={{ id: data.parent.id }} className="font-medium hover:underline">
              {data.parent.name}
            </Link>
            <span className={`text-[11px] rounded-full px-2.5 py-0.5 font-medium ${toneClasses(STATUS_TONE[data.parent.status as SystemStatus])}`}>
              {STATUS_LABEL[data.parent.status as SystemStatus] ?? data.parent.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSplitOpen((v) => !v)}
              className="text-xs bg-white/70 hover:bg-white border border-white/80 rounded-md px-2 py-1 font-medium"
              title="פורש את מערכת האב לצד המערכת הנוכחית באותו חלון"
            >
              {splitOpen ? "סגור פרישה" : "פרישה במקביל"}
            </button>
            <Link to="/systems/$id" params={{ id: data.parent.id }}
              className="text-xs underline hover:no-underline">לפתיחת המערכת הראשית</Link>
          </div>
        </div>
      )}

      {(() => {
        const cardTone = statusCardClasses(s.status);
        const managerPhone = String((s as any).manager_phone || "").trim();
        const metaSelect = "h-8 w-full min-w-0 rounded-md border border-white/70 bg-white/80 px-2 text-[11px] text-foreground focus:outline-none focus:border-primary";

        const changeStatus = (newStatus: string) => {
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
        };

        const deleteCurrentSystem = () => {
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
          if (choice === "הכל") deleteMut.mutate({ data: { id, mode: "cascade" } });
          else if (choice === "קדם") deleteMut.mutate({ data: { id, mode: "promote" } });
        };

        return (
          <section className={`rounded-xl border-2 shadow-sm overflow-visible xl:col-span-2 xl:sticky xl:top-0 xl:z-30 backdrop-blur ${cardTone}`}>
            <div className="px-3 py-2.5 md:px-4">
              {/* שורה 1 — זהות המערכת מימין, פעולות מהירות משמאל. */}
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
                  <span className={`text-[10px] rounded-full px-2.5 py-0.5 font-semibold shrink-0 ${toneClasses(STATUS_TONE[s.status as SystemStatus])}`}>
                    {STATUS_LABEL[s.status as SystemStatus]}
                  </span>
                  {isSub && (
                    <span className="text-[10px] bg-amber-50 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5 font-medium shrink-0">תת-מערכת</span>
                  )}
                  {(me?.isSuperAdmin || (me as any)?.permissions?.system_name_edit) ? (
                    <input
                      defaultValue={s.name || ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== s.name) updateMut.mutate({ data: { id, name: v } });
                      }}
                      className="min-w-[160px] max-w-[360px] bg-transparent text-xl md:text-2xl font-bold tracking-tight border-b border-transparent hover:border-white/60 focus:border-primary focus:outline-none"
                    />
                  ) : (
                    <h1 className="min-w-0 max-w-[380px] truncate text-xl md:text-2xl font-bold tracking-tight">{s.name}</h1>
                  )}
                  <span className="text-[11px] opacity-60 font-mono" dir="ltr">#{s.system_code}</span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap lg:justify-end">
                  {s.system_code && (
                    <div className="inline-flex items-center overflow-hidden rounded-lg shadow-sm">
                      <a href={`tel:${buildDialNumber(s.system_code)}`}
                        className="inline-flex h-8 items-center gap-1.5 bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                        title="חיוג למערכת דרך החייגן">
                        <Phone className="h-3.5 w-3.5" /> חיוג מערכת
                      </a>
                      <button type="button" onClick={() => copyToClipboard(s.system_code, "code", "מספר המערכת")}
                        className="inline-flex h-8 w-8 items-center justify-center border-r border-emerald-700/20 bg-white/85 hover:bg-white"
                        title="העתק מספר מערכת">
                        {copiedKey === "code" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}

                  {s.caller_phone && (
                    <div className="inline-flex items-center overflow-hidden rounded-lg shadow-sm">
                      <a href={`tel:${buildDialNumber(s.caller_phone)}`}
                        className="inline-flex h-8 items-center gap-1.5 border border-sky-200 bg-white/85 px-3 text-xs font-semibold text-sky-700 hover:bg-white"
                        title="חיוג למספר הפונה הראשי">
                        <Phone className="h-3.5 w-3.5" /> חיוג לפונה ראשי
                      </a>
                      <button type="button" onClick={() => copyToClipboard(s.caller_phone!, "caller", "מספר הפונה")}
                        className="inline-flex h-8 w-8 items-center justify-center border-y border-l border-sky-200 bg-white/85 text-sky-700 hover:bg-white"
                        title="העתק מספר פונה">
                        {copiedKey === "caller" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}

                  {managerPhone && (
                    <div className="inline-flex items-center overflow-hidden rounded-lg shadow-sm">
                      <a href={`tel:${buildDialNumber(managerPhone)}`}
                        className="inline-flex h-8 items-center gap-1.5 border border-slate-200 bg-white/85 px-3 text-xs font-semibold text-slate-700 hover:bg-white"
                        title={`חיוג למנהל ${managerPhone}`}>
                        <Phone className="h-3.5 w-3.5" /> חיוג למנהל
                      </a>
                      <button type="button" onClick={() => copyToClipboard(managerPhone, "manager", "מספר המנהל")}
                        className="inline-flex h-8 w-8 items-center justify-center border-y border-l border-slate-200 bg-white/85 hover:bg-white"
                        title="העתק מספר מנהל">
                        {copiedKey === "manager" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}

                  {s.caller_phone && (
                    <button ref={sendChoiceBtnRef} type="button"
                      disabled={!voiceEnabled || voiceMut.isPending || batchSending}
                      onClick={() => {
                        if (!showSendChoice) {
                          const r = sendChoiceBtnRef.current?.getBoundingClientRect();
                          if (r) setSendChoicePos({ top: r.bottom + 4, left: r.left });
                        }
                        setShowSendChoice((v) => !v);
                      }}
                      title={!voiceEnabled ? "לא ניתן לשלוח הודעה בסטטוס זה" : "שליחת הודעה קולית לפונה/ים"}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${!voiceEnabled ? "border-white/60 bg-white/50 text-muted-foreground/40 cursor-not-allowed" : "border-orange-200 bg-white/85 text-orange-700 hover:bg-orange-50"}`}>
                      {voiceMut.isPending || batchSending
                        ? <span className="inline-block h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <Volume2 className="h-3.5 w-3.5" />}
                      <span>שלח הודעה קולית</span>
                    </button>
                  )}

                  {me?.isSuperAdmin && (
                    <button type="button" onClick={deleteCurrentSystem} title="מחק מערכת"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/70 bg-white/75 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* שורה 2 — כל המידע הפעיל בשורה נמוכה אחת, כמו בסקיצה שאושרה. */}
              <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-white/60 pt-2.5 sm:grid-cols-3 lg:grid-cols-5">
                <div className="min-w-0 border-l border-white/60 pl-2 last:border-l-0">
                  <div className="flex items-center gap-1 text-[9px] opacity-55">
                    <span>מספר מערכת</span>
                    {!isSub && (me?.isSuperAdmin || (me as any)?.permissions?.system_code_edit) && (
                      <label className="inline-flex items-center gap-1 cursor-pointer" title="מספר חוסם">
                        <input type="checkbox" checked={!!s.is_blocking_number}
                          onChange={(e) => updateMut.mutate({ data: { id, is_blocking_number: e.target.checked } })}
                          className="h-2.5 w-2.5" />
                        <span>חסימה</span>
                      </label>
                    )}
                  </div>
                  {(me?.isSuperAdmin || (me as any)?.permissions?.system_code_edit) ? (
                    <input defaultValue={s.system_code || ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== (s.system_code || "")) updateMut.mutate({ data: { id, system_code: v } });
                      }}
                      className="mt-0.5 w-full max-w-[150px] bg-transparent font-mono text-sm font-semibold focus:outline-none" dir="ltr" />
                  ) : (
                    <div className="mt-0.5 font-mono text-sm font-semibold" dir="ltr">{s.system_code}</div>
                  )}
                </div>

                <label className="min-w-0 border-l border-white/60 pl-2 last:border-l-0">
                  <span className="mb-0.5 block text-[9px] opacity-55">נציג מטפל</span>
                  <select value={s.assigned_agent_id || ""}
                    onChange={(e) => updateMut.mutate({ data: { id, assigned_agent_id: e.target.value || null } })}
                    className={metaSelect}>
                    <option value="">— לא משויך —</option>
                    {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
                  </select>
                </label>

                <label className="min-w-0 border-l border-white/60 pl-2 last:border-l-0">
                  <span className="mb-0.5 block text-[9px] opacity-55">סטטוס ראשי</span>
                  <select value={s.status} onChange={(e) => changeStatus(e.target.value)} className={metaSelect}>
                    {STATUS_OPTIONS.filter((o) => STATUS_MANDATORY[o.value] !== false).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>

                <label className="min-w-0 border-l border-white/60 pl-2 last:border-l-0">
                  <span className="mb-0.5 block text-[9px] opacity-55">סטטוס משני</span>
                  <select value={s.secondary_status || ""}
                    onChange={(e) => updateMut.mutate({ data: { id, secondary_status: e.target.value || null } })}
                    className={metaSelect}>
                    <option value="">— ללא —</option>
                    {STATUS_OPTIONS.filter((o) => STATUS_MANDATORY[o.value] === false).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>

                <div className="min-w-0">
                  <span className="mb-0.5 block text-[9px] opacity-55">נוצר בתאריך</span>
                  <div className="h-8 flex items-center text-[11px] font-medium">
                    {s.created_at ? new Date(s.created_at).toLocaleString("he-IL", {
                      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
                    }) : "—"}
                  </div>
                </div>
              </div>
            </div>

            {showSendChoice && sendChoicePos && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSendChoice(false)} />
                <div className="fixed z-50 w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl"
                  style={{ top: sendChoicePos.top, left: Math.max(8, Math.min(sendChoicePos.left, window.innerWidth - 232)) }} dir="rtl">
                  <button type="button" onClick={() => { setShowSendChoice(false); sendVoiceBatch(voiceRecipients); }}
                    className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-xs hover:bg-accent">
                    <span>שלח לכל מספרי הפונה</span><span className="text-muted-foreground">{voiceRecipients.length}</span>
                  </button>
                  <button type="button" disabled={unsentRecipients.length === 0}
                    onClick={() => { setShowSendChoice(false); sendVoiceBatch(unsentRecipients); }}
                    className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-xs hover:bg-accent disabled:opacity-50">
                    <span>שלח רק למי שטרם נשלח</span><span className="text-muted-foreground">{unsentRecipients.length}</span>
                  </button>
                  <button type="button" onClick={() => { setShowSendChoice(false); setShowSendPicker(true); }}
                    className="w-full text-right px-2 py-2 rounded-lg text-xs hover:bg-accent">בחר פונה אחד...</button>
                </div>
              </>
            )}

            {showSendPicker && (
              <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSendPicker(false)}>
                <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-4 space-y-2" dir="rtl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-bold">בחר פונה לשליחה</h3>
                    <button onClick={() => setShowSendPicker(false)} className="p-1 hover:bg-accent rounded"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  {voiceRecipients.length === 0 ? (
                    <p className="text-xs text-muted-foreground">אין מספרי פונה מוגדרים.</p>
                  ) : (
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                      {voiceRecipients.map((r) => (
                        <button key={r.index} type="button"
                          onClick={() => {
                            setShowSendPicker(false);
                            const confirmMsg = r.sentAt ? "ההודעה כבר נשלחה לפונה זה בעבר. לשלוח שוב?" : "לשלוח הודעה קולית לפונה זה כעת?";
                            if (!window.confirm(confirmMsg)) return;
                            voiceMut.mutate({ systemId: id, phoneIndex: r.index });
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border hover:bg-accent text-xs">
                          <span className="font-mono" dir="ltr">{r.phone}</span>
                          <span className="text-muted-foreground">{r.label}{r.sentAt ? " · נשלח" : ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* ===== פרטי קשר + מספרי פונה ===== */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm xl:col-start-1">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <button type="button" onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition"
            aria-expanded={detailsOpen}>
            <Phone className="h-4 w-4" />מספרי פונה ופרטי קשר
            <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          </button>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button"
              onClick={() => {
                const next = !detailsDefaultOpen;
                setDetailsDefaultOpen(next);
                try { window.localStorage.setItem("crm.details.defaultOpen", next ? "1" : "0"); } catch {}
                setDetailsOpen(next);
                toast.success(next ? "הפרטים ייפתחו אוטומטית" : "הפרטים יהיו מכווצים אוטומטית");
              }}
              className={`text-[11px] px-2 py-1 border rounded-md ${detailsDefaultOpen ? "bg-primary/10 border-primary/30 text-primary" : "border-input bg-background hover:bg-accent"}`}>
              {detailsDefaultOpen ? "פתוח כברירת מחדל" : "סגור כברירת מחדל"}
            </button>
            {me?.isAdmin && (
              !isSub ? (
                <button onClick={() => { setShowParentPick(true); setParentChoice(""); setDetailsOpen(true); }}
                  className="text-[11px] px-2 py-1 border border-input rounded-md bg-background hover:bg-accent">
                  הפוך לתת-מערכת
                </button>
              ) : (
                <button onClick={() => parentMut.mutate({ data: { id, parent_system_id: null } })}
                  className="text-[11px] px-2 py-1 border border-input rounded-md bg-background hover:bg-accent">
                  הפוך למערכת ראשית
                </button>
              )
            )}
          </div>
        </div>

        {showParentPick && !isSub && (
          <div className="mb-3">
            <ParentPicker
              mains={mains ?? []}
              excludeId={id}
              value={parentChoice}
              onChange={setParentChoice}
              onConfirm={() => parentMut.mutate({ data: { id, parent_system_id: parentChoice } })}
              onCancel={() => setShowParentPick(false)}
            />
          </div>
        )}

        {detailsOpen && (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_290px] gap-4 items-start">
            <div className="min-w-0 rounded-xl border border-border bg-muted/10 p-3">
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

            <aside className="space-y-2">
              <CompactPhoneField
                label="מספר מנהל"
                value={String((s as any).manager_phone || "")}
                emptyLabel="הוסף מספר מנהל"
                onSave={(v) => updateMut.mutate({ data: { id, manager_phone: v || null } as any })}
                copyKey="manager-details"
                copiedKey={copiedKey}
                onCopy={(v) => copyToClipboard(v, "manager-details", "מספר המנהל")}
              />

              <CompactEmailField
                initial={(s as any).email || ""}
                onSave={(v) => updateMut.mutate({ data: { id, email: v } })}
              />

              {(s.phone || false) ? (
                <CompactPhoneField
                  label="טלפון נוסף"
                  value={s.phone || ""}
                  emptyLabel="הוסף טלפון נוסף"
                  onSave={(v) => updateMut.mutate({ data: { id, phone: v || null } })}
                  copyKey="legacy-phone"
                  copiedKey={copiedKey}
                  onCopy={(v) => copyToClipboard(v, "legacy-phone", "הטלפון")}
                />
              ) : (
                <CompactPhoneField
                  label="טלפון נוסף"
                  value=""
                  emptyLabel="הוסף טלפון נוסף"
                  onSave={(v) => updateMut.mutate({ data: { id, phone: v || null } })}
                  copyKey="legacy-phone"
                  copiedKey={copiedKey}
                  onCopy={(v) => copyToClipboard(v, "legacy-phone", "הטלפון")}
                />
              )}

              <div className="rounded-xl border border-border bg-background p-3">
                <AdditionalEmailsEditor
                  emails={((s as any).additional_emails ?? []) as string[]}
                  onChange={(next) => updateMut.mutate({ data: { id, additional_emails: next } })}
                />
              </div>
            </aside>
          </div>
        )}
      </div>

      {/* ===== פעילות ===== */}
      <div className="bg-card border border-border rounded-xl p-4 xl:col-start-2 xl:row-span-6 xl:sticky xl:top-[8.5rem] xl:max-h-[calc(100vh-9.5rem)] xl:overflow-y-auto">
        {/* ===== פעילות: הערות + היסטוריה ===== */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            פעילות ({data.notes.length + data.activity.length + data.transfers.length})
          </h2>
          {mentionFilter && (
            <button type="button" onClick={() => setMentionFilter(null)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90">
              מסונן לפי @{mentionFilter}
              <X className="h-3 w-3" />
            </button>
          )}
        </div>


        <form onSubmit={(e) => { e.preventDefault(); const body = serializeNote(); if (body) noteMut.mutate({ data: { system_id: id, body } }); }}
          className="flex gap-2 mb-3 relative items-start">
          <div className="relative flex-1">
            <div
              ref={noteEditorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="הוסף הערה"
              onInput={handleNoteInput}
              onKeyDown={(e) => {
                if (mentionQuery !== null && mentionOptions.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionActiveIndex((i) => Math.min(i + 1, mentionOptions.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionActiveIndex((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const pick = mentionOptions[mentionActiveIndex] ?? mentionOptions[0];
                    if (pick) insertMention(pick.label);
                    return;
                  }
                  if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const body = serializeNote();
                  if (body) noteMut.mutate({ data: { system_id: id, body } });
                }
              }}
              data-placeholder="הוסף הערה... הקלד @ לתיוג"
              className="min-h-[36px] w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {mentionQuery !== null && mentionOptions.length > 0 && (
              <div className="absolute right-0 left-0 top-full mt-1 z-20 max-h-56 overflow-auto rounded-lg border border-border bg-popover shadow-lg">
                {mentionOptions.map((opt, idx) => {
                  const initial = (opt.label || "?").trim().charAt(0);
                  const active = idx === mentionActiveIndex;
                  return (
                    <button key={opt.id} type="button"
                      onMouseDown={(e) => { e.preventDefault(); insertMention(opt.label); }}
                      onMouseEnter={() => setMentionActiveIndex(idx)}
                      className={`w-full text-right px-3 py-2 text-sm flex items-center gap-2 ${active ? "bg-accent" : "hover:bg-accent"}`}>
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary/15 text-primary text-[11px] font-semibold">{initial}</span>
                      <span className="flex-1">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button type="submit" className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
            <Send className="h-4 w-4" />
          </button>
        </form>

        {/* סינון יומן הפעילות */}
        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
          <select aria-label="סינון לפי פעולה" value={activityActionFilter} onChange={(e) => setActivityActionFilter(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2">
            <option value="">כל הפעולות</option>
            <option value="created">נוצרה</option>
            <option value="updated">עודכנה</option>
            <option value="deleted">נמחקה</option>
            <option value="denied">נדחתה הרשאה</option>
          </select>
          <select aria-label="סינון לפי משתמש" value={activityActorFilter} onChange={(e) => setActivityActorFilter(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2">
            <option value="">כל המשתמשים</option>
            {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
          <input type="date" aria-label="מתאריך" value={activityFrom} onChange={(e) => setActivityFrom(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2" />
          <input type="date" aria-label="עד תאריך" value={activityTo} onChange={(e) => setActivityTo(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2" />
          {(activityActionFilter || activityActorFilter || activityFrom || activityTo) && (
            <button type="button" className="h-7 px-2 rounded-md border border-border hover:bg-accent"
              onClick={() => { setActivityActionFilter(""); setActivityActorFilter(""); setActivityFrom(""); setActivityTo(""); }}>
              נקה סינון
            </button>
          )}
        </div>

        <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
          {(() => {
            const baseActivity = [...data.activity, ...olderActivity];
            const passesFilters = (a: any) => {
              if (activityActionFilter && a.action !== activityActionFilter) return false;
              if (activityActorFilter && a.actor_id !== activityActorFilter) return false;
              if (activityFrom && new Date(a.created_at) < new Date(activityFrom)) return false;
              if (activityTo && new Date(a.created_at) > new Date(`${activityTo}T23:59:59`)) return false;
              return true;
            };
            const filtersActive = !!(activityActionFilter || activityActorFilter || activityFrom || activityTo);
            const allMerged = [
              ...(filtersActive ? [] : data.notes.map((n: any) => ({ kind: "note" as const, at: n.created_at, item: n }))),
              ...baseActivity.filter(passesFilters).map((a: any) => ({ kind: "activity" as const, at: a.created_at, item: a })),
              ...(filtersActive ? [] : data.transfers.map((t: any) => ({ kind: "transfer" as const, at: t.created_at, item: t }))),
            ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
            const merged = mentionFilter
              ? allMerged.filter((row) => row.kind === "note" && typeof (row.item as any).body === "string" && (row.item as any).body.includes(`@${mentionFilter}`))
              : allMerged;

            if (merged.length === 0) {
              return <p className="text-sm text-muted-foreground text-center py-8">{mentionFilter ? `אין הערות עם @${mentionFilter}` : "אין פעילות עדיין"}</p>;
            }
            return merged.map((row) => {
              const canEditHistory = !!(me as any)?.permissions?.history_edit;
              const myId = (me as any)?.userId as string | undefined;
              if (row.kind === "note") {
                const n = row.item;
                const initial = (n.author_name || "?").trim().charAt(0);
                const canEditNote = canEditHistory || (myId && n.author_id === myId);
                return (
                  <div key={`n-${n.id}`} className="border border-border rounded-lg p-2.5 bg-background group">
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{renderNoteBody(n.body || "")}</div>
                    <div className="text-[11px] text-muted-foreground mt-1.5 flex justify-between items-center">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">{initial}</span>
                        {n.author_name}
                      </span>
                      <span className="flex items-center gap-2">
                        {canEditNote && (
                          <>
                            <button
                              type="button"
                              title="ערוך הערה"
                              className="opacity-0 group-hover:opacity-100 hover:text-primary transition"
                              onClick={() => {
                                const next = window.prompt("עריכת הערה:", n.body || "");
                                if (next !== null && next.trim() && next !== n.body) {
                                  editNoteMut.mutate({ data: { id: n.id, body: next.trim() } });
                                }
                              }}
                            >✎</button>
                            <button
                              type="button"
                              title="מחק הערה"
                              className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition"
                              onClick={() => {
                                if (window.confirm("למחוק את ההערה?")) removeNoteMut.mutate({ data: { id: n.id } });
                              }}
                            >🗑</button>
                          </>
                        )}
                        <span>{new Date(n.created_at).toLocaleString("he-IL")}</span>
                      </span>
                    </div>
                  </div>
                );
              }

              if (row.kind === "transfer") {
                const t = row.item;
                return (
                  <div key={`t-${t.id}`} className="rounded-lg border border-border bg-background p-2.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1">
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
                <div key={`a-${a.id}`} className="rounded-lg border border-border bg-background p-2.5 hover:bg-accent/30 transition group">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1">
                    <span className="font-medium text-foreground">{a.actor_name}</span>
                    <span className="flex items-center gap-2">
                      {canEditHistory && (
                        <>
                          <button
                            type="button"
                            title="ערוך סיבה"
                            className="opacity-0 group-hover:opacity-100 hover:text-primary transition"
                            onClick={() => {
                              const next = window.prompt("עריכת סיבה:", a.reason || "");
                              if (next !== null) {
                                editActivityMut.mutate({ data: { id: a.id, reason: next } });
                              }
                            }}
                          >✎</button>
                          <button
                            type="button"
                            title="מחק שורה"
                            className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition"
                            onClick={() => {
                              if (window.confirm("למחוק שורת יומן זו?")) removeActivityMut.mutate({ data: { id: a.id } });
                            }}
                          >🗑</button>
                        </>
                      )}
                      <span>{new Date(a.created_at).toLocaleString("he-IL")}</span>
                    </span>
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
          {activityHasMore && (
            <div className="pt-2 text-center">
              <button type="button" disabled={activityLoading}
                onClick={() => loadMoreActivity(data.activity.length)}
                className="text-xs px-3 py-1.5 rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50">
                {activityLoading ? "טוען…" : "טען עוד"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== לשוניות עבודה ===== */}
      <div className="xl:col-start-1 flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {WORK_TABS.filter((t) => t.key !== "subs" || !isSub).map((t) => {
          const count =
            t.key === "emails" ? (emailThread?.length ?? 0)
            : t.key === "subs" ? (data.children?.length ?? 0)
            : t.key === "files" ? (files?.length ?? 0)
            : (s.reminder_at ? 1 : 0);
          const active = tab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => selectTab(t.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
              {t.label}
              <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white/20" : "bg-muted"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* ===== תזכורות ===== */}
      {tab === "reminders" && (
        <div className="bg-card border border-border rounded-xl p-4 xl:col-start-1">

          <ReminderSection
            hasReminder={!!s.reminder_at}
            headerSummary={
              s.reminder_at ? (
                <span>
                  תזכורת ל-<strong>{new Date(s.reminder_at).toLocaleString("he-IL")}</strong>
                </span>
              ) : (
                <span className="opacity-70">אין תזכורת</span>
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
                  <span className="opacity-80">שיוך:</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="reminder-scope" checked={reminderScope === "all"}
                      onChange={() => { setReminderScope("all"); setReminderAgentIds([]); }} />
                    כולם
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="reminder-scope" checked={reminderScope === "specific"}
                      onChange={() => setReminderScope("specific")} />
                    נבחרים
                  </label>
                </div>
                {reminderScope === "specific" && (
                  <div className="flex flex-wrap gap-1.5 p-2 border border-input rounded-md bg-background max-h-32 overflow-auto">
                    {(agents ?? []).map((a: any) => {
                      const checked = reminderAgentIds.includes(a.id);
                      return (
                        <label key={a.id} className={`flex items-center gap-1 px-2 py-0.5 rounded-md border cursor-pointer text-xs ${checked ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"}`}>
                          <input type="checkbox" className="hidden" checked={checked}
                            onChange={(e) => setReminderAgentIds((prev) => e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id))} />
                          {a.display_name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </ReminderSection>
        </div>
      )}

      {/* ===== מיילים ===== */}
      {tab === "emails" && (
        <div className="bg-card border border-border rounded-xl p-4 xl:col-start-1">

          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-semibold flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4" />
              מיילים
              <span className="text-[11px] font-normal text-muted-foreground">({emailThread?.length ?? 0})</span>
            </h2>
            <button type="button" onClick={openNewEmail}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-l from-fuchsia-600 to-fuchsia-500 text-white text-xs font-medium hover:from-fuchsia-700 hover:to-fuchsia-600 shadow-sm">
              <Send className="h-3.5 w-3.5" />הודעה חדשה
            </button>
          </div>

          {(!emailThread || emailThread.length === 0) ? (
            <button type="button" onClick={openNewEmail}
              className="w-full rounded-xl border-2 border-dashed border-border p-6 text-center hover:bg-accent/30 hover:border-fuchsia-300 transition">
              <Mail className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
              <div className="text-sm font-medium mb-1">אין עדיין מיילים בכרטיסייה הזו</div>
              <div className="text-[11px] text-muted-foreground">לחץ כדי לפתוח שיחת מייל חדשה</div>
            </button>
          ) : (
            <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
              {[...emailThread].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((m: any) => {
                const isOutbound = m.direction === "outbound";
                const isExpanded = expandedMessages.has(m.id);
                const body = m.body ?? "";
                const isLong = body.length > 220;
                const shownBody = isExpanded || !isLong ? body : body.slice(0, 220) + "…";
                const replyTo = isOutbound ? (m.to_address || "") : extractEmail(m.from_address || "");
                const senderLabel = isOutbound ? (m.agent_name || "נציג") : (extractEmail(m.from_address || "") || "פונה");
                const initial = (senderLabel || "?").trim().charAt(0).toUpperCase();
                return (
                  <div key={m.id} className={`flex gap-2 ${isOutbound ? "flex-row" : "flex-row-reverse"}`}>
                    <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold shadow-sm ${isOutbound ? "bg-fuchsia-600 text-white" : "bg-primary/15 text-primary"}`}>
                      {initial}
                    </div>
                    <div className={`flex-1 min-w-0 rounded-2xl px-3.5 py-2.5 ${isOutbound ? "bg-fuchsia-50 border border-fuchsia-200 rounded-tr-sm" : "bg-muted border border-border rounded-tl-sm"}`}>
                      <div className={`flex items-center justify-between gap-3 text-[11px] mb-1 ${isOutbound ? "text-fuchsia-800" : "text-muted-foreground"}`}>
                        <span className="font-semibold truncate" title={senderLabel}>{senderLabel}</span>
                        <span className="shrink-0">{new Date(m.created_at).toLocaleString("he-IL")}</span>
                      </div>
                      {m.subject && <div className="text-sm font-semibold mb-1 leading-tight">{m.subject}</div>}
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{shownBody}</div>
                      <div className={`flex items-center gap-0.5 mt-2 pt-2 border-t flex-wrap ${isOutbound ? "border-fuchsia-200/70" : "border-black/5"}`}>
                        {isLong && (
                          <button type="button"
                            onClick={() => setExpandedMessages((prev) => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
                            title={isExpanded ? "הצג פחות" : "הצג הכל"}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-black/5">
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </button>
                        )}
                        <button type="button"
                          onClick={() => { if (inlineReplyFor === m.id) { setInlineReplyFor(null); return; } setInlineReplyFor(m.id); setInlineReplyText(""); }}
                          title="השב"
                          className={`h-7 px-2 inline-flex items-center gap-1 rounded-md text-[11px] font-medium ${inlineReplyFor === m.id ? "bg-fuchsia-600 text-white" : "hover:bg-black/5"}`}>
                          <CornerUpRight className="h-3.5 w-3.5 -scale-x-100" />השב
                        </button>
                        <button type="button" onClick={() => openForwardEmail(m)}
                          title="העבר"
                          className="h-7 px-2 inline-flex items-center gap-1 rounded-md hover:bg-black/5 text-[11px] font-medium">
                          <CornerUpRight className="h-3.5 w-3.5" />העבר
                        </button>
                        <button type="button" onClick={() => openReplyEmail(m)}
                          title="פתח בחלון מלא"
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-black/5">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                        {replyTo && (
                          <button type="button" onClick={() => copyToClipboard(replyTo, `mail-${m.id}`, "כתובת המייל")}
                            title="העתק כתובת מייל"
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-black/5">
                            {copiedKey === `mail-${m.id}` ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                      {inlineReplyFor === m.id && (
                        <div className="mt-2.5 space-y-1.5 rounded-lg border border-fuchsia-200 bg-white p-2">
                          <div className="text-[10px] text-muted-foreground">השב אל <span className="font-medium text-foreground" dir="ltr">{replyTo || "—"}</span></div>
                          <EmailContentEditor value={inlineReplyText} onChange={setInlineReplyText} rows={3}
                            placeholder="כתוב תשובה מהירה..." cleanupLevel={emailCleanupLevel}
                            onCleanupLevelChange={setEmailCleanupLevel} label="תשובה" />
                          <div className="flex items-center justify-between gap-1.5">
                            <button type="button" onClick={() => openReplyEmail(m)}
                              className="text-[11px] text-muted-foreground hover:text-foreground">פתח בחלון מלא ↗</button>
                            <div className="flex items-center gap-1.5">
                              <button type="button" onClick={() => { setInlineReplyFor(null); setInlineReplyText(""); }}
                                className="text-[11px] px-2 py-1 rounded-md hover:bg-black/5">בטל</button>
                              <button type="button"
                                disabled={sendEmailMut.isPending || !inlineReplyText.trim() || !replyTo}
                                onClick={() => {
                                  sendEmailMut.mutate({
                                    to: replyTo,
                                    subject: m.subject ? (m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`) : "Re: ",
                                    body: inlineReplyText.trim(),
                                    gmail_thread_id: m.gmail_thread_id ?? null,
                                    cleanup_level: emailCleanupLevel,
                                  }, { onSuccess: () => { setInlineReplyFor(null); setInlineReplyText(""); } });
                                }}
                                className="text-[11px] px-3 py-1 rounded-md bg-fuchsia-600 text-white font-medium hover:bg-fuchsia-700 disabled:opacity-50 inline-flex items-center gap-1">
                                <Send className="h-3 w-3" />
                                {sendEmailMut.isPending ? "שולח…" : "שלח"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}




      {composeOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setComposeOpen(false)}>
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Mail className="h-4 w-4" />
                {composeMode === "reply" ? "השבה למייל" : composeMode === "forward" ? "העברת מייל" : "שליחת מייל"}
              </h3>
              <button onClick={() => setComposeOpen(false)} className="p-1 hover:bg-accent rounded"><X className="h-3.5 w-3.5" /></button>
            </div>
            {(emailTemplates ?? []).length > 0 && (
              <select onChange={(e) => {
                const t = (emailTemplates ?? []).find((tp: any) => tp.id === e.target.value) as any;
                if (t) applyTemplate(t);
              }} defaultValue="" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="" disabled>בחר תבנית (אופציונלי)</option>
                {(emailTemplates ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="כתובת מייל של הפונה" dir="ltr"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="נושא"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <EmailContentEditor value={composeBody} onChange={setComposeBody} rows={6}
              cleanupLevel={emailCleanupLevel} onCleanupLevelChange={setEmailCleanupLevel} />
            {emailGeneralName?.generalName && (
              <div className="flex items-center gap-4 text-xs bg-muted/50 rounded-lg px-3 py-2">
                <span className="font-medium text-muted-foreground">שלח בשם:</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={!composeUseGeneral} onChange={() => setComposeUseGeneral(false)} />
                  השם שלי ({me?.displayName || "נציג"})
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={composeUseGeneral} onChange={() => setComposeUseGeneral(true)} />
                  {emailGeneralName.generalName}
                </label>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">החתימה האישית שלך תתווסף אוטומטית בסוף ההודעה.</p>
            <button
              onClick={() => {
                if (!composeTo.trim()) { toast.error("יש להזין כתובת מייל"); return; }
                if (!composeBody.trim()) { toast.error("יש להזין תוכן"); return; }
                sendEmailMut.mutate({
                  to: composeTo.trim(), subject: composeSubject.trim(), body: composeBody.trim(),
                  gmail_thread_id: composeMode === "reply" ? composeThreadId : null,
                  use_general_name: composeUseGeneral,
                  cleanup_level: emailCleanupLevel,
                });
              }}
              disabled={sendEmailMut.isPending}
              className="w-full px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-700 disabled:opacity-50">
              {sendEmailMut.isPending ? "שולח..." : "שלח"}
            </button>
          </div>
        </div>
      )}


      {/* ===== תתי-מערכות ===== */}
      {tab === "subs" && !isSub && (
        <div className="bg-card border border-border rounded-2xl p-4 xl:col-start-1">
          <h2 className="font-semibold flex items-center gap-2 mb-3 text-sm">
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
      {tab === "files" && (
      <div className="bg-card border border-border rounded-2xl p-4 xl:col-start-1">

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
      )}

    </div>
    {splitOpen && data.parent && (
      <div className="flex-1 min-w-0 sticky top-4 border-2 border-primary/40 rounded-xl overflow-hidden bg-card shadow-lg" style={{ height: "calc(100vh - 2rem)" }}>
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <span className="text-sm font-medium">מערכת אב — תצוגה במקביל</span>
          <button onClick={() => setSplitOpen(false)} className="text-xs px-2 py-1 rounded border hover:bg-accent">סגור פרישה</button>
        </div>
        <iframe src={`/systems/${data.parent.id}`} className="w-full border-0 block" style={{ height: "calc(100% - 40px)" }} title="מערכת אב" />
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

function AdditionalEmailsEditor({ emails, onChange }: { emails: string[]; onChange: (next: string[]) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (!v.includes("@")) { toast.error("כתובת מייל לא תקינה"); return; }
    if (emails.includes(v)) { toast.error("כתובת זו כבר קיימת"); return; }
    onChange([...emails, v]);
    setDraft("");
    setShowAdd(false);
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium">כתובות מייל נוספות</label>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-input bg-background hover:bg-accent text-foreground"
          title="הוסף כתובת מייל נוספת">
          <Plus className="h-3.5 w-3.5" /> הוסף מייל
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {emails.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 bg-muted rounded-full pl-1 pr-2 py-1 text-xs">
            <span dir="ltr">{e}</span>
            <button type="button" onClick={() => onChange(emails.filter((x) => x !== e))}
              className="p-0.5 hover:bg-accent rounded-full"><X className="h-3 w-3" /></button>
          </span>
        ))}
        {emails.length === 0 && !showAdd && <span className="text-xs text-muted-foreground italic">אין כתובות נוספות</span>}
      </div>
      {showAdd && (
        <div className="flex gap-1">
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } else if (e.key === "Escape") { setShowAdd(false); setDraft(""); } }}
            placeholder="name@example.com" type="email" dir="ltr" autoFocus
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground" />
          <button type="button" onClick={add}
            className="px-3 py-2 border border-input rounded-lg bg-background hover:bg-accent text-xs font-medium">
            הוסף
          </button>
          <button type="button" onClick={() => { setShowAdd(false); setDraft(""); }}
            className="px-2 py-2 border border-input rounded-lg bg-background hover:bg-accent text-xs">
            בטל
          </button>
        </div>
      )}
    </div>
  );
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
        // Prevent input blur from firing first with the partial (invalid) value
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!val || val.includes("@")) return;
          const next = val.trim() + "@gmail.com";
          setVal(next);
          if (next !== (initial || "")) onSave(next);
        }}
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

function CompactPhoneField({
  label, value, emptyLabel, onSave, copyKey, copiedKey, onCopy,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  onSave: (value: string) => void;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const digits = String(value || "").replace(/\D/g, "");
  const commit = () => {
    const next = draft.trim();
    if (next !== (value || "").trim()) onSave(next);
    setEditing(false);
  };

  if (!value && !editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="w-full rounded-xl border border-dashed border-input bg-background px-3 py-3 text-right text-xs font-medium text-primary hover:bg-accent">
        <span className="inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />{emptyLabel}</span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {!editing && <button type="button" onClick={() => setEditing(true)} className="p-1 rounded hover:bg-accent" title="ערוך"><Pencil className="h-3.5 w-3.5" /></button>}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
            onBlur={commit}
            placeholder={emptyLabel}
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-2 text-sm font-mono" dir="ltr" />
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold" dir="ltr">{value}</span>
          {digits && <a href={`tel:${buildDialNumber(digits)}`} className="h-8 w-8 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 inline-flex items-center justify-center hover:bg-emerald-100" title="חייג"><Phone className="h-3.5 w-3.5" /></a>}
          <button type="button" onClick={() => onCopy(value)} className="h-8 w-8 rounded-lg border border-border inline-flex items-center justify-center hover:bg-accent" title="העתק">
            {copiedKey === copyKey ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

function CompactEmailField({ initial, onSave }: { initial: string; onSave: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(initial);
  useEffect(() => setVal(initial), [initial]);
  const commit = () => {
    const next = val.trim();
    if (next !== (initial || "")) onSave(next || null);
  };

  if (!initial && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-input bg-background px-3 py-3 text-right text-xs font-medium text-primary hover:bg-accent">
        <span className="inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />הוסף כתובת דוא&quot;ל</span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-right">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Mail className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-medium">דוא&quot;ל</span>
          {!open && initial && <span className="text-xs text-muted-foreground truncate max-w-[150px]" dir="ltr">{initial}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 flex gap-1">
          <input type="email" value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
            placeholder="name@example.com" dir="ltr"
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-2 text-sm" />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => {
            if (!val || val.includes("@")) return;
            const next = val.trim() + "@gmail.com";
            setVal(next); onSave(next);
          }} className="rounded-lg border border-input px-2 text-[11px] hover:bg-accent">@gmail.com</button>
        </div>
      )}
    </div>
  );
}

function CallerPhoneRow({
  initial, sentAt, voiceEnabled, sending, onSave, onSend, onRemove, showRemove, isPrimary,
}: {
  initial: string;
  sentAt: string | null | undefined;
  voiceEnabled: boolean;
  sending: boolean;
  onSave: (v: string) => void;
  onSend: () => void;
  onRemove?: () => void;
  showRemove: boolean;
  isPrimary?: boolean;
}) {
  const [val, setVal] = useState(initial);
  const [editing, setEditing] = useState(!initial);
  useEffect(() => { setVal(initial); if (initial) setEditing(false); }, [initial]);
  const digits = (val || "").replace(/\D/g, "");

  const commit = () => {
    const next = val.trim();
    if (next !== (initial || "").trim()) onSave(next);
    if (next) setEditing(false);
  };

  if (!initial && !editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="min-h-[96px] rounded-xl border border-dashed border-input bg-background p-3 text-xs font-medium text-primary hover:bg-accent">
        <span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" />הוסף מספר פונה ראשי</span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3 shadow-sm min-w-0">
      {editing ? (
        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">{isPrimary ? "מספר פונה ראשי" : "מספר פונה"}</div>
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape" && initial) { setVal(initial); setEditing(false); } }}
            onBlur={commit}
            placeholder="מספר טלפון"
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm font-mono" dir="ltr" />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-base font-semibold" dir="ltr">{initial}</span>
                {isPrimary && <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ראשי</span>}
              </div>
              {sentAt ? <div className="mt-1 text-[10px] text-emerald-700">✓ {new Date(sentAt).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</div> : <div className="mt-1 text-[10px] text-muted-foreground">טרם נשלחה הודעה</div>}
            </div>
            <button type="button" onClick={() => setEditing(true)} className="p-1 rounded-md text-muted-foreground hover:bg-accent" title="ערוך"><Pencil className="h-3.5 w-3.5" /></button>
          </div>

          <div className="mt-3 flex items-center gap-1.5">
            {digits && <a href={`tel:${buildDialNumber(digits)}`} title="חייג"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><Phone className="h-3.5 w-3.5" /></a>}
            {digits && <button type="button" onClick={() => navigator.clipboard.writeText(digits).then(() => toast.success("המספר הועתק"))}
              title="העתק" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent"><Copy className="h-3.5 w-3.5" /></button>}
            <button type="button" disabled={!voiceEnabled || sending || !digits}
              onClick={() => { if (window.confirm(sentAt ? "ההודעה כבר נשלחה בעבר. לשלוח שוב?" : "לשלוח הודעה קולית לפונה כעת?")) onSend(); }}
              title={!voiceEnabled ? "לא ניתן לשלוח הודעה בסטטוס זה" : "שלח הודעה קולית"}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${!voiceEnabled ? "opacity-40 cursor-not-allowed" : sentAt ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100"}`}>
              <Volume2 className="h-3.5 w-3.5" />
            </button>
            {showRemove && onRemove && <button type="button" onClick={() => { if (window.confirm("להסיר מספר פונה זה?")) onRemove(); }} title="הסר מספר"
              className="mr-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        </>
      )}
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
  const count = (primary ? 1 : 0) + additional.filter((p) => !!p.phone).length;

  const add = () => {
    const value = newPhone.trim();
    if (!value) return;
    onAddAdditional(value);
    setNewPhone("");
    setShowAdd(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold">מספרי פונה</label>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{count}</span>
        </div>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-primary/25 bg-primary/5 hover:bg-primary/10 text-primary"
          title="הוסף מספר פונה נוסף">
          <Plus className="h-3.5 w-3.5" /> הוסף מספר פונה
        </button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        <CallerPhoneRow
          initial={primary}
          sentAt={primarySentAt}
          voiceEnabled={voiceEnabled}
          sending={sending}
          onSave={onSavePrimary}
          onSend={onSendPrimary}
          showRemove={false}
          isPrimary
        />
        {additional.map((entry, i) => (
          <CallerPhoneRow
            key={`${i}-${entry.phone}`}
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
        {showAdd && (
          <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 min-h-[96px] flex flex-col justify-center gap-2">
            <input autoFocus value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } else if (e.key === "Escape") { setShowAdd(false); setNewPhone(""); } }}
              placeholder="מספר חדש"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm font-mono" dir="ltr" />
            <div className="flex gap-2">
              <button type="button" disabled={!newPhone.trim()} onClick={add} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">הוסף</button>
              <button type="button" onClick={() => { setShowAdd(false); setNewPhone(""); }} className="rounded-lg border border-input px-3 py-1.5 text-xs">ביטול</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

