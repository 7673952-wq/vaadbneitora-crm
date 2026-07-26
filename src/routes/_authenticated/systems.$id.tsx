import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSystem, listAgents, listMainSystems,
  updateSystem, addNote, deleteSystem, addSubSystem,
  setReminder, dismissReminder, setParent, sendVoiceMessage,
  addAdditionalCallerPhone, updateAdditionalCallerPhone, removeAdditionalCallerPhone,
  updateNote, deleteNote, updateActivityLog, deleteActivityLog,
} from "@/lib/systems.functions";

import { getMyRole, listStatusSettings } from "@/lib/admin.functions";
import { listSystemEmailThread, sendSystemEmail, listEmailTemplates, getEmailGeneralName } from "@/lib/email.functions";
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
  Info, Paperclip, Upload, Download, FileText, ChevronDown, Copy, Check, Volume2, X, Mail, ExternalLink,
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
  const [showSendChoice, setShowSendChoice] = useState(false);
  const [sendChoicePos, setSendChoicePos] = useState<{ top: number; left: number } | null>(null);
  const sendChoiceBtnRef = useRef<HTMLButtonElement>(null);
  const [showSendPicker, setShowSendPicker] = useState(false);
  const [batchSending, setBatchSending] = useState(false);

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

  const { data, isLoading } = useQuery({ queryKey: ["system", id], queryFn: () => getFn({ data: { id } }) });
  // Reference/settings data changes rarely — cache it longer than the 30s
  // default so opening a system card and returning to the dashboard (which
  // reads the same query keys) doesn't re-fetch it every time.
  const REFERENCE_STALE_TIME = 5 * 60_000;
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn(), staleTime: REFERENCE_STALE_TIME });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({ headers: await getAuthHeaders() }), staleTime: REFERENCE_STALE_TIME });
  const { data: mains } = useQuery({ queryKey: ["mainSystems"], queryFn: () => mainsFn(), staleTime: REFERENCE_STALE_TIME });
  const { data: statusSettings } = useQuery({ queryKey: ["status_settings"], queryFn: () => statusSettingsFn(), staleTime: REFERENCE_STALE_TIME });
  const noteEditorRef = useRef<HTMLDivElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
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
    queryFn: async () => emailTemplatesFn({ headers: await getAuthHeaders() }),
  });
  const emailGeneralNameFn = useServerFn(getEmailGeneralName);
  const { data: emailGeneralName } = useQuery({
    queryKey: ["email_general_name"],
    queryFn: async () => emailGeneralNameFn({ headers: await getAuthHeaders() }),
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"new" | "reply" | "forward">("new");
  const [composeThreadId, setComposeThreadId] = useState<string | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeUseGeneral, setComposeUseGeneral] = useState(false);
  // Inline quick-reply state (avoids opening a modal for a fast response)
  const [inlineReplyFor, setInlineReplyFor] = useState<string | null>(null);
  const [inlineReplyText, setInlineReplyText] = useState("");
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const sendEmailMut = useMutation({
    mutationFn: (v: { to: string; subject: string; body: string; gmail_thread_id?: string | null; use_general_name?: boolean }) =>
      sendEmailFn({ data: { system_id: id, ...v } }),
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
    <div className={splitOpen && data.parent ? "space-y-6 flex-1 min-w-0" : "space-y-6 max-w-5xl mx-auto"}>
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
        <div className={`border-2 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap ${statusCardClasses(data.parent.status)}`}>
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
        const btnBase = "inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md transition";
        const iconBtn = "inline-flex items-center justify-center h-8 w-8 rounded-md border border-white/70 bg-white/70 text-foreground hover:bg-white transition";
        const chip = "rounded-md border border-white/70 bg-white/80 px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary";
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
        return (
          <div className={`border-2 rounded-xl overflow-hidden shadow-sm ${cardTone}`}>
            <div className="p-3 flex items-start justify-between gap-3 flex-wrap">
              {/* Title zone */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[11px] rounded-full px-2.5 py-0.5 font-semibold ${toneClasses(STATUS_TONE[s.status as SystemStatus])}`}>
                    {STATUS_LABEL[s.status as SystemStatus]}
                  </span>
                  {isSub && <span className="text-[11px] bg-amber-50 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5 font-medium">תת-מערכת</span>}
                  {(me?.isSuperAdmin || (me as any)?.permissions?.system_code_edit) ? (
                    <input
                      defaultValue={s.system_code || ""}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== (s.system_code || "")) updateMut.mutate({ data: { id, system_code: v } }); }}
                      className="text-[11px] font-mono bg-white/70 rounded px-2 py-0.5 border border-white/70 w-32 focus:outline-none focus:border-primary"
                      title="מזהה מערכת"
                    />
                  ) : (
                    <span className="text-[11px] font-mono bg-white/70 rounded px-2 py-0.5">{s.system_code}</span>
                  )}
                  {!isSub && (me?.isSuperAdmin || (me as any)?.permissions?.system_code_edit) && (
                    <label className="flex items-center gap-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5 cursor-pointer"
                      title="בהודעה קולית על סיום הפניה יישלח מספר המערכת הפוך וללא קידומת 0">
                      <input type="checkbox" checked={!!s.is_blocking_number}
                        onChange={(e) => updateMut.mutate({ data: { id, is_blocking_number: e.target.checked } })}
                        className="h-3 w-3" />
                      חסימה
                    </label>
                  )}
                </div>
                {(me?.isSuperAdmin || (me as any)?.permissions?.system_name_edit) ? (
                  <input
                    defaultValue={s.name || ""}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) updateMut.mutate({ data: { id, name: v } }); }}
                    className="text-lg md:text-xl font-bold tracking-tight mt-1.5 bg-transparent border-b border-transparent hover:border-white/60 focus:border-primary focus:outline-none w-full"
                  />
                ) : (
                  <h1 className="text-lg md:text-xl font-bold tracking-tight mt-1.5 truncate">{s.name}</h1>
                )}
                {/* Inline status + agent + secondary status selects */}
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <select value={s.status} onChange={(e) => changeStatus(e.target.value)} className={chip} title="סטטוס">
                    {STATUS_OPTIONS.filter((o) => STATUS_MANDATORY[o.value] !== false).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select value={s.assigned_agent_id || ""} onChange={(e) => updateMut.mutate({ data: { id, assigned_agent_id: e.target.value || null } })} className={chip} title="נציג מטפל">
                    <option value="">— לא משויך —</option>
                    {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
                  </select>
                  <select
                    value={s.secondary_status || ""}
                    onChange={(e) => updateMut.mutate({ data: { id, secondary_status: e.target.value || null } })}
                    className={chip}
                    title="סטטוס משני">
                    <option value="">— סטטוס משני —</option>
                    {STATUS_OPTIONS.filter((o) => STATUS_MANDATORY[o.value] === false).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {s.created_at && (
                  <div className="mt-2 text-[11px] opacity-70">
                    שעת יצירה: {new Date(s.created_at).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                  </div>
                )}
              </div>

              {/* Actions zone */}
              <div className="flex flex-wrap gap-1.5 items-center shrink-0">
                {s.system_code && (
                  <div className="inline-flex items-stretch rounded-md overflow-hidden shadow-sm">
                    <a href={`tel:${buildDialNumber(s.system_code)}`}
                      className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                      <Phone className="h-3.5 w-3.5" />
                      <span>מערכת</span>
                    </a>
                    <button onClick={() => copyToClipboard(s.system_code, "code", "מזהה המערכת")}
                      title="העתק מזהה מערכת"
                      className="inline-flex items-center justify-center h-8 w-8 bg-white/80 hover:bg-white text-muted-foreground border-r border-white/70">
                      {copiedKey === "code" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
                {s.caller_phone && (
                  <div className="relative inline-flex items-stretch">
                    <div className="inline-flex items-stretch rounded-md overflow-hidden shadow-sm">
                    <a href={`tel:${buildDialNumber(s.caller_phone)}`}
                      className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium bg-sky-600 text-white hover:bg-sky-700">
                      <Phone className="h-3.5 w-3.5" />
                      <span>פונה</span>
                    </a>
                    <button onClick={() => copyToClipboard(s.caller_phone!, "caller", "מספר הפונה")}
                      title="העתק מספר פונה"
                      className="inline-flex items-center justify-center h-8 w-8 bg-white/80 hover:bg-white text-muted-foreground border-r border-white/70">
                      {copiedKey === "caller" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      ref={sendChoiceBtnRef}
                      type="button"
                      disabled={!voiceEnabled || voiceMut.isPending || batchSending}
                      onClick={() => {
                        if (!showSendChoice) {
                          const r = sendChoiceBtnRef.current?.getBoundingClientRect();
                          if (r) setSendChoicePos({ top: r.bottom + 4, left: r.left });
                        }
                        setShowSendChoice((v) => !v);
                      }}
                      title={!voiceEnabled ? "לא ניתן לשלוח הודעה בסטטוס זה" : "שליחת הודעה קולית לפונה/ים דרך ימות המשיח"}
                      aria-label="שלח הודעה קולית"
                      className={`inline-flex items-center justify-center h-8 w-8 border-r border-white/70 transition ${
                        !voiceEnabled
                          ? "bg-white/60 text-muted-foreground/40 cursor-not-allowed"
                          : voiceAlreadySent
                            ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100"
                      }`}>
                      {voiceMut.isPending || batchSending
                        ? <span className="inline-block h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    </div>

                    {showSendChoice && sendChoicePos && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowSendChoice(false)} />
                        <div
                          className="fixed z-50 w-64 bg-popover border border-border rounded-lg shadow-lg p-2 space-y-1"
                          style={{ top: sendChoicePos.top, left: sendChoicePos.left }}
                          dir="rtl">
                        <div className="text-xs font-semibold text-muted-foreground px-1 pb-1">למי לשלוח הודעה קולית?</div>
                        <button type="button"
                          onClick={() => {
                            setShowSendChoice(false);
                            if (!window.confirm(`לשלוח הודעה קולית לכל ${voiceRecipients.length} הפונים?`)) return;
                            sendVoiceBatch(voiceRecipients);
                          }}
                          className="w-full text-right px-2 py-1.5 rounded-md text-xs hover:bg-accent flex items-center justify-between">
                          <span>שלח לכולם</span>
                          <span className="text-muted-foreground">{voiceRecipients.length}</span>
                        </button>
                        <button type="button"
                          onClick={() => {
                            setShowSendChoice(false);
                            if (unsentRecipients.length === 0) { toast.info("לכולם כבר נשלחה הודעה"); return; }
                            if (!window.confirm(`לשלוח הודעה קולית ל-${unsentRecipients.length} פונים שעדיין לא נשלחה אליהם הודעה?`)) return;
                            sendVoiceBatch(unsentRecipients);
                          }}
                          className="w-full text-right px-2 py-1.5 rounded-md text-xs hover:bg-accent flex items-center justify-between">
                          <span>רק למי שעדיין לא נשלח</span>
                          <span className="text-muted-foreground">{unsentRecipients.length}</span>
                        </button>
                        <button type="button"
                          onClick={() => { setShowSendChoice(false); setShowSendPicker(true); }}
                          className="w-full text-right px-2 py-1.5 rounded-md text-xs hover:bg-accent">
                          אחד מהפונים...
                        </button>
                        </div>
                      </>
                    )}

                    {showSendPicker && (
                      <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSendPicker(false)}>
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
                  </div>
                )}
                {s.phone && (
                  <a href={`tel:${s.phone}`}
                    className={`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm`}>
                    <Phone className="h-3.5 w-3.5" />
                    {s.phone}
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
                    className={`${iconBtn} hover:!text-destructive hover:!bg-destructive/10`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== פרטים ===== */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <button type="button" onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition"
            aria-expanded={detailsOpen}>
            <Info className="h-4 w-4" />פרטים
            <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          </button>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button"
              onClick={() => {
                const next = !detailsDefaultOpen;
                setDetailsDefaultOpen(next);
                try { window.localStorage.setItem("crm.details.defaultOpen", next ? "1" : "0"); } catch {}
                setDetailsOpen(next);
                toast.success(next ? "פרטים ייפתחו אוטומטית" : "פרטים יהיו מכווצים אוטומטית");
              }}
              title={detailsDefaultOpen ? "ברירת מחדל: פרוש. לחץ כדי לקבוע מכווץ" : "ברירת מחדל: מכווץ. לחץ כדי לקבוע פרוש"}
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
        {detailsOpen && (<>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium block mb-1 text-muted-foreground">טלפון לחיוג</label>
            <input
              defaultValue={s.phone || ""}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.phone || "")) updateMut.mutate({ data: { id, phone: v || null } }); }}
              placeholder="מספר טלפון"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1 text-muted-foreground">דוא"ל</label>
            <EmailField initial={(s as any).email || ""} onSave={(v) => updateMut.mutate({ data: { id, email: v } })} />
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
          <div className="md:col-span-2">
            <AdditionalEmailsEditor
              emails={((s as any).additional_emails ?? []) as string[]}
              onChange={(next) => updateMut.mutate({ data: { id, additional_emails: next } })}
            />
          </div>
        </div>
        </>)}
      </div>



      {/* ===== פעילות ===== */}
      <div className="bg-card border border-border rounded-xl p-4">
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

        <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
          {(() => {
            const allMerged = [
              ...data.notes.map((n: any) => ({ kind: "note" as const, at: n.created_at, item: n })),
              ...data.activity.map((a: any) => ({ kind: "activity" as const, at: a.created_at, item: a })),
              ...data.transfers.map((t: any) => ({ kind: "transfer" as const, at: t.created_at, item: t })),
            ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
            const merged = mentionFilter
              ? allMerged.filter((row) => row.kind === "note" && typeof (row.item as any).body === "string" && (row.item as any).body.includes(`@${mentionFilter}`))
              : allMerged;

            if (merged.length === 0) {
              return <p className="text-sm text-muted-foreground text-center py-8">{mentionFilter ? `אין הערות עם @${mentionFilter}` : "אין פעילות עדיין"}</p>;
            }
            return merged.map((row) => {
              if (row.kind === "note") {
                const n = row.item;
                const initial = (n.author_name || "?").trim().charAt(0);
                return (
                  <div key={`n-${n.id}`} className="border border-border rounded-lg p-2.5 bg-background">
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{renderNoteBody(n.body || "")}</div>
                    <div className="text-[11px] text-muted-foreground mt-1.5 flex justify-between items-center">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">{initial}</span>
                        {n.author_name}
                      </span>
                      <span>{new Date(n.created_at).toLocaleString("he-IL")}</span>
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
                <div key={`a-${a.id}`} className="rounded-lg border border-border bg-background p-2.5 hover:bg-accent/30 transition">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1">
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

      {/* ===== תזכורות + מיילים (side-by-side) ===== */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* תזכורות */}
        <div className="bg-card border border-border rounded-xl p-4">
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

        {/* מיילים */}
        <div className="bg-card border border-border rounded-xl p-4">
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
                          <textarea
                            value={inlineReplyText}
                            onChange={(e) => setInlineReplyText(e.target.value)}
                            placeholder="כתוב תשובה מהירה..."
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
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
      </div>



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
            <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} placeholder="תוכן ההודעה" rows={6}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
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


