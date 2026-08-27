import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Mail, Search, Send, RefreshCw, Settings2, PenSquare, Inbox, ArrowUpRight, Users,
  MailOpen, SendHorizontal, Trash2, Pencil, IdCard, X, Check,
} from "lucide-react";
import { EmailContentEditor } from "@/components/EmailContentEditor";
import type { EmailCleanupLevel } from "@/lib/email-cleanup";
import {
  listMailThreads, getMailThread, sendMailboxMessage, markMailThreadRead,
  getMailboxSettings, listMailContacts, updateMailMessage, deleteMailMessage, deleteMailThread,
} from "@/lib/mail.functions";
import { setMyEmailSignature } from "@/lib/email.functions";
import { getMyRole } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/mail")({
  component: MailboxPage,
  head: () => ({
    meta: [
      { title: "מיילים | תיבת הדואר של ה-CRM" },
      { name: "description", content: "תיבת דואר מרכזית לשליחה וקבלה של מיילים מול פונים, כולל שרשורים, תבניות וחתימה אישית." },
      { property: "og:title", content: "מיילים | תיבת הדואר של ה-CRM" },
      { property: "og:description", content: "שליחה, קבלה ומעקב אחרי כל התכתובות במייל במקום אחד." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Filter = "all" | "unread" | "inbox" | "sent";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "הכל" },
  { key: "unread", label: "לא נקראו" },
  { key: "inbox", label: "נכנס" },
  { key: "sent", label: "יוצא" },
];

const FILTER_ICONS = {
  all: Mail,
  unread: MailOpen,
  inbox: Inbox,
  sent: SendHorizontal,
} satisfies Record<Filter, typeof Mail>;

function fmt(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function initials(text: string) {
  const t = (text || "?").trim();
  return t.slice(0, 2).toUpperCase();
}

/** Badge shown whenever a conversation is linked to a CRM card. */
function CardBadge({ label = "מכרטיס מערכת" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
      <IdCard className="h-3 w-3" /> {label}
    </span>
  );
}

function MailboxPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMailThreads);
  const contactsFn = useServerFn(listMailContacts);
  const threadFn = useServerFn(getMailThread);
  const sendFn = useServerFn(sendMailboxMessage);
  const readFn = useServerFn(markMailThreadRead);
  const settingsFn = useServerFn(getMailboxSettings);
  const signatureFn = useServerFn(setMyEmailSignature);
  const roleFn = useServerFn(getMyRole);
  const editFn = useServerFn(updateMailMessage);
  const deleteMsgFn = useServerFn(deleteMailMessage);
  const deleteThreadFn = useServerFn(deleteMailThread);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => roleFn({}),
    staleTime: 5 * 60_000,
  });
  const mailPerms = (me as any)?.mailPermissions ?? {};
  const canManageMail = Boolean(me?.isSuperAdmin);
  const canViewMail = Boolean(me?.isSuperAdmin || mailPerms.mailbox_view);
  const canEditMail = Boolean(me?.isSuperAdmin || mailPerms.emails_edit);
  const canDeleteMail = Boolean(me?.isSuperAdmin || mailPerms.emails_delete);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cleanup, setCleanup] = useState<EmailCleanupLevel>("standard");
  const [useGeneral, setUseGeneral] = useState(false);
  const [reply, setReply] = useState("");
  const [signature, setSignature] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const { data: settings } = useQuery({
    queryKey: ["mailbox_settings"],
    queryFn: async () => settingsFn({}),
    enabled: canViewMail,
    staleTime: 60_000,
  });
  useEffect(() => { if (settings?.signature != null) setSignature(settings.signature); }, [settings?.signature]);
  useEffect(() => {
    if (!settings?.prefs) return;
    setCleanup(settings.prefs.defaultCleanupLevel as EmailCleanupLevel);
    setUseGeneral(settings.prefs.defaultUseGeneralName);
    setFilter(settings.prefs.defaultFilter as Filter);
  }, [settings?.prefs]);

  const refreshMs = (settings?.prefs?.refreshSeconds ?? 60) * 1000;
  const { data: threads = [], isFetching, refetch } = useQuery({
    queryKey: ["mail_threads", filter, search],
    queryFn: async () => listFn({ data: { filter, search: search || undefined } }),
    enabled: canViewMail,
    refetchInterval: refreshMs > 0 ? refreshMs : false,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["mail_contacts", search],
    enabled: canViewMail && contactsOpen,
    queryFn: async () => contactsFn({ data: { search: search || undefined } }),
    staleTime: 60_000,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["mail_thread", selected],
    enabled: canViewMail && !!selected,
    queryFn: async () => {
      if (!selected) return [];
      return threadFn({ data: { threadId: selected } });
    },
  });

  const current = useMemo(() => threads.find((t) => t.threadId === selected) ?? null, [threads, selected]);
  const unreadTotal = useMemo(() => threads.reduce((sum, t) => sum + t.unread, 0), [threads]);

  const openThread = async (threadId: string) => {
    setSelected(threadId);
    setReply("");
    setEditingId(null);
    if (!threadId.startsWith("msg:")) {
      try {
        await readFn({ data: { threadId } });
        qc.invalidateQueries({ queryKey: ["mail_threads"] });
      } catch { /* read marking is best-effort */ }
    }
  };

  const refreshMail = () => {
    qc.invalidateQueries({ queryKey: ["mail_threads"] });
    qc.invalidateQueries({ queryKey: ["mail_thread"] });
  };

  const send = useMutation({
    mutationFn: async (vars: { to: string; subject?: string; body: string; threadId?: string | null }) =>
      sendFn({ data: { ...vars, useGeneralName: useGeneral, cleanupLevel: cleanup } }),
    onSuccess: (res) => {
      toast.success("המייל נשלח");
      setComposing(false); setTo(""); setSubject(""); setBody(""); setReply("");
      refreshMail();
      if (res?.threadId) setSelected(res.threadId);
    },
    onError: (e: any) => toast.error(e?.message ?? "שליחת המייל נכשלה"),
  });

  const editMsg = useMutation({
    mutationFn: async (vars: { id: string; body: string }) =>
      editFn({ data: vars }),
    onSuccess: () => { toast.success("ההודעה עודכנה"); setEditingId(null); refreshMail(); },
    onError: (e: any) => toast.error(e?.message ?? "העריכה נכשלה"),
  });

  const removeMsg = useMutation({
    mutationFn: async (id: string) => deleteMsgFn({ data: { id } }),
    onSuccess: () => { toast.success("ההודעה נמחקה"); refreshMail(); },
    onError: (e: any) => toast.error(e?.message ?? "המחיקה נכשלה"),
  });

  const removeThread = useMutation({
    mutationFn: async (threadId: string) => deleteThreadFn({ data: { threadId } }),
    onSuccess: () => { toast.success("השרשור נמחק"); setSelected(null); refreshMail(); },
    onError: (e: any) => toast.error(e?.message ?? "המחיקה נכשלה"),
  });

  const saveSignature = useMutation({
    mutationFn: async () => signatureFn({ data: { signature } }),
    onSuccess: () => { toast.success("החתימה נשמרה"); qc.invalidateQueries({ queryKey: ["mailbox_settings"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שמירה נכשלה"),
  });

  if (me && !canViewMail) {
    return (
      <div dir="rtl" className="rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">
        אין לך הרשאה לצפות בתיבת הדואר. פנה למנהל המערכת.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-gradient-to-l from-primary/10 via-card to-card px-4 py-3 shadow-sm">
        <div className="flex flex-1 min-w-[200px] items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">תיבת דואר</h1>
            <p className="text-xs text-muted-foreground">
              {settings?.configured
                ? `${settings.address || "תיבה משותפת"} · ${threads.length} שיחות${unreadTotal ? ` · ${unreadTotal} לא נקראו` : ""}`
                : "החיבור לתיבת המייל לא מוגדר — ניהול → מיילים"}
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בכתובות, נושא ותוכן..."
            className="w-64 rounded-full border border-input bg-background/80 py-2 pr-9 pl-3 text-sm outline-none transition focus:border-primary"
          />
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} title="רענון" aria-label="רענון תיבת הדואר">
          <RefreshCw className={isFetching ? "animate-spin" : ""} />
        </Button>
        <Button size="sm" className="rounded-full" onClick={() => { setComposing(true); setSelected(null); }}>
          <PenSquare /> מייל חדש
        </Button>
      </header>

      {settingsOpen && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div><div className="text-xs text-muted-foreground">כתובת שולחת</div>{settings?.address || "לא הוגדרה"}</div>
            <div><div className="text-xs text-muted-foreground">השם שלי במיילים</div>{settings?.myName || "—"}</div>
            <div><div className="text-xs text-muted-foreground">שם כללי</div>{settings?.generalName || "—"}</div>
          </div>
          {settings?.prefs?.allowPersonalSignature !== false ? (
            <>
              <div>
                <label className="text-xs font-medium">חתימה אישית</label>
                <textarea
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  placeholder="החתימה שתתווסף בסוף כל מייל שאשלח"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => saveSignature.mutate()} disabled={saveSignature.isPending}>שמירת חתימה</Button>
                {canManageMail && (
                  <a href="/admin" className="text-xs text-primary underline">הגדרות תיבת הדואר (ניהול → מיילים)</a>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              עריכת חתימה אישית מושבתת על ידי מנהל המערכת.
              {canManageMail && <a href="/admin" className="text-primary underline">ניהול → מיילים</a>}
            </div>
          )}
        </div>
      )}

      {contactsOpen && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" /> אנשי קשר מהמייל ({contacts.length})
          </div>
          {contacts.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">אין עדיין אנשי קשר</div>
          ) : (
            <div className="grid max-h-[40vh] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {contacts.map((c) => (
                <div key={c.email} className="rounded-xl border border-border p-2.5 transition hover:border-primary/40">
                  <div className="truncate text-sm font-medium">{c.name || c.email}</div>
                  <div className="truncate text-[11px] text-muted-foreground" dir="ltr">{c.email}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{c.messages} הודעות</span><span>·</span><span>{fmt(c.lastAt)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setTo(c.email); setComposing(true); setSelected(null); }}>
                      <PenSquare /> מייל
                    </Button>
                    {c.systemId && (
                      <a href={`/systems/${c.systemId}`} className="inline-flex items-center gap-1 text-[11px] text-primary">
                        <ArrowUpRight className="h-3 w-3" /> כרטיס
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid min-h-[calc(100vh-13rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-[180px_340px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-muted/40 p-3 md:border-b-0 md:border-l">
          <nav className="grid grid-cols-2 gap-1 md:grid-cols-1" aria-label="תיקיות דואר">
            {FILTERS.map((f) => {
              const Icon = FILTER_ICONS[f.key];
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-background"}`}
                >
                  <Icon className="h-4 w-4" />
                  {f.label}
                  {f.key === "unread" && unreadTotal > 0 && (
                    <span className={`mr-auto rounded-full px-1.5 text-[10px] ${active ? "bg-primary-foreground/20" : "bg-primary/15 text-primary"}`}>{unreadTotal}</span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="mt-3 space-y-1 border-t border-border pt-3">
            <Button variant={contactsOpen ? "secondary" : "ghost"} className="w-full justify-start rounded-lg px-2.5" onClick={() => setContactsOpen((v) => !v)}>
              <Users /> אנשי קשר
            </Button>
            <Button variant={settingsOpen ? "secondary" : "ghost"} className="w-full justify-start rounded-lg px-2.5" onClick={() => setSettingsOpen((v) => !v)}>
              <Settings2 /> הגדרות אישיות
            </Button>
          </div>
        </aside>

        <section className="border-b border-border md:border-b-0 md:border-l" aria-label="רשימת הודעות">
          <div className="flex h-11 items-center justify-between border-b border-border px-3 text-xs text-muted-foreground">
            <span>{threads.length} שיחות</span>
            {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          </div>
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto p-2 md:max-h-[calc(100vh-13rem)]">
            {threads.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Inbox className="mx-auto mb-2 h-5 w-5" /> אין הודעות להצגה
              </div>
            )}
            <div className="space-y-1.5">
              {threads.map((t) => {
                const active = selected === t.threadId;
                const fromCard = Boolean(t.systemId || t.recordId);
                return (
                  <button
                    key={t.threadId}
                    onClick={() => openThread(t.threadId)}
                    className={`w-full rounded-xl border p-2.5 text-right transition ${active ? "border-primary/50 bg-primary/5 shadow-sm" : "border-transparent hover:border-border hover:bg-muted/50"}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${t.unread > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {initials(t.displayName || t.address)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`flex-1 truncate text-sm ${t.unread > 0 ? "font-semibold" : ""}`}>{t.displayName || t.address || "—"}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{fmt(t.lastAt)}</span>
                        </div>
                        <div className="truncate text-xs">{t.subject || "(ללא נושא)"}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{t.snippet}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {fromCard && <CardBadge label={t.recordId ? "מכרטיס ב-CRM" : "מכרטיס מערכת"} />}
                          {t.unread > 0 && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">{t.unread} חדשות</span>
                          )}
                          {t.count > 1 && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t.count} הודעות</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <main className="min-h-[50vh] min-w-0 bg-background p-4">
          {!selected && !composing && (
            <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
              <div>
                <Mail className="mx-auto mb-2 h-8 w-8 opacity-40" />
                בחר שיחה מהרשימה או פתח מייל חדש
              </div>
            </div>
          )}

          {composing && (
            <div className="mx-auto max-w-3xl space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold">מייל חדש</h2>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="אל (כתובת מייל)"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="נושא"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
              <EmailContentEditor value={body} onChange={setBody} cleanupLevel={cleanup} onCleanupLevelChange={setCleanup} rows={8} />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => send.mutate({ to, subject, body })} disabled={send.isPending || !to || !body.trim()}>
                  <Send /> שליחה
                </Button>
                <Button variant="outline" onClick={() => setComposing(false)}>ביטול</Button>
                {settings?.generalName && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={useGeneral} onChange={(e) => setUseGeneral(e.target.checked)} />
                    שליחה בשם הכללי ({settings.generalName})
                  </label>
                )}
              </div>
            </div>
          )}

          {selected && !composing && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm">
                <div className="min-w-[160px] flex-1">
                  <div className="text-sm font-semibold">{current?.subject || "(ללא נושא)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {current?.displayName ? `${current.displayName} · ` : ""}
                    <span dir="ltr">{current?.address}</span>
                  </div>
                </div>
                {(current?.systemId || current?.recordId) && <CardBadge label={current?.recordId ? "מכרטיס ב-CRM" : "מכרטיס מערכת"} />}
                {current?.systemId && (
                  <a href={`/systems/${current.systemId}`} className="inline-flex items-center gap-1 text-xs text-primary">
                    <ArrowUpRight className="h-3 w-3" /> כרטיס המערכת
                  </a>
                )}
                {canDeleteMail && (
                  <Button
                    variant="ghost" size="icon" title="מחיקת השרשור" aria-label="מחיקת השרשור"
                    onClick={() => { if (confirm("למחוק את כל השיחה מהמערכת?")) removeThread.mutate(selected); }}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
              </div>

              <div className="max-h-[45vh] space-y-2.5 overflow-y-auto pl-1">
                {messages.map((m) => {
                  const inbound = m.direction === "in" || m.direction === "inbound";
                  const sender = inbound ? (m.fromName || m.fromAddress || "לא ידוע") : (m.agentName || "נציג");
                  const recipient = inbound ? (m.toName || m.toAddress || "") : (m.toName || m.toAddress || current?.address || "");
                  const fromCard = Boolean(m.systemId || m.recordId);
                  const editing = editingId === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`rounded-2xl border p-3 text-sm shadow-sm ${inbound ? "border-border bg-card" : "border-primary/25 bg-primary/5"}`}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          <span className="font-medium text-foreground">{sender}</span>
                          {recipient ? <> ← אל {recipient}</> : null}
                        </span>
                        {fromCard && <CardBadge label={m.recordId ? "נשלח מכרטיס ב-CRM" : "נשלח מכרטיס מערכת"} />}
                        <span className="mr-auto shrink-0">{new Date(m.createdAt).toLocaleString("he-IL")}</span>
                        {canEditMail && !editing && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="עריכה" aria-label="עריכת ההודעה"
                            onClick={() => { setEditingId(m.id); setEditBody(m.body); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDeleteMail && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="מחיקה" aria-label="מחיקת ההודעה"
                            onClick={() => { if (confirm("למחוק את ההודעה מהמערכת?")) removeMsg.mutate(m.id); }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                      {editing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            rows={6}
                            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                          />
                          <div className="flex items-center gap-2">
                            <Button size="sm" disabled={!editBody.trim() || editMsg.isPending}
                              onClick={() => editMsg.mutate({ id: m.id, body: editBody })}>
                              <Check /> שמירה
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}><X /> ביטול</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{m.body}</div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
                <EmailContentEditor
                  value={reply}
                  onChange={setReply}
                  cleanupLevel={cleanup}
                  onCleanupLevelChange={setCleanup}
                  rows={4}
                  label="תגובה בשרשור"
                  placeholder="כתוב תגובה..."
                />
                <Button
                  onClick={() => send.mutate({ to: current?.address ?? "", subject: current?.subject ?? "", body: reply, threadId: selected })}
                  disabled={send.isPending || !reply.trim() || !current?.address}
                >
                  <Send /> שליחת תגובה
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
