import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Mail, Search, Send, RefreshCw, Settings2, PenSquare, Inbox, ArrowUpRight, Circle, Users } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth-headers";
import { EmailContentEditor } from "@/components/EmailContentEditor";
import type { EmailCleanupLevel } from "@/lib/email-cleanup";
import { listMailThreads, getMailThread, sendMailboxMessage, markMailThreadRead, getMailboxSettings, listMailContacts } from "@/lib/mail.functions";
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

function fmt(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
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

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => roleFn({ headers: await getAuthHeaders() }),
    staleTime: 5 * 60_000,
  });
  // רק מנהל-על רואה את הקישור להגדרות תיבת הדואר בניהול
  const canManageMail = Boolean(me?.isSuperAdmin);
  const canViewMail = Boolean(me?.isSuperAdmin || (me?.permissions as any)?.mailbox_view);

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

  const { data: settings } = useQuery({
    queryKey: ["mailbox_settings"],
    queryFn: async () => settingsFn({ headers: await getAuthHeaders() }),
    staleTime: 60_000,
  });
  useEffect(() => { if (settings?.signature != null) setSignature(settings.signature); }, [settings?.signature]);
  // Admin-managed defaults (ניהול → תיבת דואר)
  useEffect(() => {
    if (!settings?.prefs) return;
    setCleanup(settings.prefs.defaultCleanupLevel as EmailCleanupLevel);
    setUseGeneral(settings.prefs.defaultUseGeneralName);
    setFilter(settings.prefs.defaultFilter as Filter);
  }, [settings?.prefs]);

  const refreshMs = (settings?.prefs?.refreshSeconds ?? 60) * 1000;
  const { data: threads = [], isFetching, refetch } = useQuery({
    queryKey: ["mail_threads", filter, search],
    queryFn: async () => listFn({ data: { filter, search: search || undefined }, headers: await getAuthHeaders() }),
    refetchInterval: refreshMs > 0 ? refreshMs : false,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["mail_contacts", search],
    enabled: contactsOpen,
    queryFn: async () => contactsFn({ data: { search: search || undefined }, headers: await getAuthHeaders() }),
    staleTime: 60_000,
  });



  const { data: messages = [] } = useQuery({
    queryKey: ["mail_thread", selected],
    enabled: !!selected,
    queryFn: async () => threadFn({ data: { threadId: selected! }, headers: await getAuthHeaders() }),
  });

  const current = useMemo(() => threads.find((t) => t.threadId === selected) ?? null, [threads, selected]);

  const openThread = async (threadId: string) => {
    setSelected(threadId);
    setReply("");
    if (!threadId.startsWith("msg:")) {
      try {
        await readFn({ data: { threadId }, headers: await getAuthHeaders() });
        qc.invalidateQueries({ queryKey: ["mail_threads"] });
      } catch { /* read marking is best-effort */ }
    }
  };

  const send = useMutation({
    mutationFn: async (vars: { to: string; subject?: string; body: string; threadId?: string | null }) =>
      sendFn({ data: { ...vars, useGeneralName: useGeneral, cleanupLevel: cleanup }, headers: await getAuthHeaders() }),
    onSuccess: (res) => {
      toast.success("המייל נשלח");
      setComposing(false); setTo(""); setSubject(""); setBody(""); setReply("");
      qc.invalidateQueries({ queryKey: ["mail_threads"] });
      qc.invalidateQueries({ queryKey: ["mail_thread"] });
      if (res?.threadId) setSelected(res.threadId);
    },
    onError: (e: any) => toast.error(e?.message ?? "שליחת המייל נכשלה"),
  });

  const saveSignature = useMutation({
    mutationFn: async () => signatureFn({ data: { signature }, headers: await getAuthHeaders() }),
    onSuccess: () => { toast.success("החתימה נשמרה"); qc.invalidateQueries({ queryKey: ["mailbox_settings"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שמירה נכשלה"),
  });

  if (me && !canViewMail) {
    return (
      <div dir="rtl" className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
        אין לך הרשאה לצפות בתיבת הדואר. פנה למנהל המערכת.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-3">
      <div className="rounded-xl border border-border p-4 flex flex-wrap items-center gap-3 bg-gradient-to-l from-primary/10 to-transparent">
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Mail className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">מיילים</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {settings?.configured
                ? `תיבה משותפת${settings.address ? ` — ${settings.address}` : ""} · ${threads.length} שרשורים`
                : "החיבור לתיבת המייל לא מוגדר — ניהול → מיילים"}
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בכתובות, נושא ותוכן..."
            className="w-60 rounded-lg border border-input bg-background pr-8 pl-3 py-1.5 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "animate-spin" : ""} /> רענון
        </Button>
        <Button variant={contactsOpen ? "default" : "outline"} size="sm" onClick={() => setContactsOpen((v) => !v)}>
          <Users /> אנשי קשר
        </Button>
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen((v) => !v)}>
          <Settings2 /> הגדרות
        </Button>
        <Button size="sm" onClick={() => setComposing(true)}>
          <PenSquare /> מייל חדש
        </Button>
      </div>

      {settingsOpen && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
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
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="החתימה שתתווסף בסוף כל מייל שאשלח"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => saveSignature.mutate()} disabled={saveSignature.isPending}>שמירת חתימה</Button>
                {canManageMail && (
                  <a href="/admin" className="text-xs text-primary underline">הגדרות תיבת הדואר (ניהול → תיבת דואר)</a>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              עריכת חתימה אישית מושבתת על ידי מנהל המערכת.
              {canManageMail && (
                <a href="/admin" className="text-primary underline">ניהול → תיבת דואר</a>
              )}
            </div>
          )}

        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-1 border-b border-border p-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
            {threads.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Inbox className="mx-auto mb-2 h-5 w-5" /> אין הודעות להצגה
              </div>
            )}
            {threads.map((t) => (
              <button
                key={t.threadId}
                onClick={() => openThread(t.threadId)}
                className={`w-full text-right p-3 transition hover:bg-muted/60 ${selected === t.threadId ? "bg-muted" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {t.unread > 0 && <Circle className="h-2 w-2 shrink-0 fill-primary text-primary" />}
                  <span className={`flex-1 truncate text-sm ${t.unread > 0 ? "font-semibold" : ""}`}>{t.displayName || t.address || "—"}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{fmt(t.lastAt)}</span>
                </div>
                {t.displayName && t.address && (
                  <div className="truncate text-[11px] text-muted-foreground" dir="ltr">{t.address}</div>
                )}
                <div className="truncate text-xs mt-0.5">{t.subject || "(ללא נושא)"}</div>
                <div className="truncate text-[11px] text-muted-foreground mt-0.5">{t.snippet}</div>
              </button>
            ))}
          </div>

        </div>

        <div className="rounded-xl border border-border bg-card p-4 min-h-[50vh]">
          {!selected && !composing && (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">בחר שרשור מהרשימה או פתח מייל חדש</div>
          )}

          {composing && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">מייל חדש</h2>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="אל (כתובת מייל)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="נושא"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
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
              <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
                <div className="flex-1 min-w-[160px]">
                  <div className="text-sm font-semibold">{current?.subject || "(ללא נושא)"}</div>
                  <div className="text-xs text-muted-foreground">{current?.address}</div>
                </div>
                {current?.systemId && (
                  <a href={`/systems/${current.systemId}`} className="text-xs text-primary inline-flex items-center gap-1">
                    <ArrowUpRight className="h-3 w-3" /> כרטיס המערכת
                  </a>
                )}
              </div>
              <div className="max-h-[45vh] space-y-2 overflow-y-auto">
                {messages.map((m) => {
                  const inbound = m.direction === "in" || m.direction === "inbound";
                  return (
                    <div key={m.id} className={`rounded-lg border border-border p-3 text-sm ${inbound ? "bg-muted/40" : "bg-primary/5"}`}>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{inbound ? `מ־${m.fromAddress ?? ""}` : `נשלח על ידי ${m.agentName ?? "נציג"}`}</span>
                        <span>{new Date(m.createdAt).toLocaleString("he-IL")}</span>
                      </div>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2 border-t border-border pt-3">
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
        </div>
      </div>
    </div>
  );
}
