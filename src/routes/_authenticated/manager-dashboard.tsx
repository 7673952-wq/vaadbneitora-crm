import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { getManagerDashboard, getSystemsByCallerPhone } from "@/lib/manager-dashboard.functions";
import { getMyRole, listPendingVoiceSends } from "@/lib/admin.functions";
import { scanSystemSeries, createMissingSystems, manualSendPendingVoice, rescheduleVoicePending } from "@/lib/systems.functions";
import { STATUS_OPTIONS, STATUS_LABEL, buildDialNumber } from "@/lib/status";
import { getAuthHeaders } from "@/lib/auth-headers";
import { LayoutDashboard, AlertTriangle, CheckCircle2, Clock, TrendingUp, Plus, BarChart3, ArrowLeft, Search, X, Volume2, RefreshCw, Send, Phone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/manager-dashboard")({
  head: () => ({ meta: [{ title: "דשבורד מנהלים | CRM" }] }),
  loader: ({ context }) => {
    context.queryClient.prefetchQuery({
      queryKey: ["manager-dashboard"],
      queryFn: async () => getManagerDashboard({ headers: await getAuthHeaders() }),
      staleTime: 30_000,
    });
  },
  component: ManagerDashboard,
});

function ManagerDashboard() {
  const meFn = useServerFn(getMyRole);
  const fn = useServerFn(getManagerDashboard);
  const [showSeries, setShowSeries] = useState(false);
  const [showPendingMessages, setShowPendingMessages] = useState(false);
  const [tab, setTab] = useState<"overview" | "phones">("overview");
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({ headers: await getAuthHeaders() }), staleTime: 5 * 60_000 });
  const { data, isLoading } = useQuery({
    queryKey: ["manager-dashboard"],
    queryFn: async () => fn({ headers: await getAuthHeaders() }),
    enabled: me?.isAdmin === true,
    staleTime: 30_000,
  });

  if (me && !me.isAdmin) {
    return <div className="text-center py-20"><h2 className="text-xl font-semibold">אין הרשאה</h2><p className="text-muted-foreground mt-2">דף זה מיועד למנהלים בלבד.</p></div>;
  }
  if (isLoading || !data) {
    return <div className="text-center py-20 text-muted-foreground">טוען נתונים...</div>;
  }

  const maxPerf = Math.max(1, ...data.agentPerformance.map((a) => a.actions));

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">דשבורד מנהלים</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowSeries(true)}
            className="flex items-center gap-2 border border-emerald-400 text-emerald-800 bg-emerald-50 px-3 py-2 rounded-lg text-sm font-medium hover:bg-emerald-100">
            <Search className="h-4 w-4" />השלמת סדרות
          </button>
          {!!(me?.permissions as any)?.settings_manage && (
            <button onClick={() => setShowPendingMessages(true)}
              className="flex items-center gap-2 border border-fuchsia-400 text-fuchsia-800 bg-fuchsia-50 px-3 py-2 rounded-lg text-sm font-medium hover:bg-fuchsia-100">
              <Send className="h-4 w-4" />הודעות ממתינות
            </button>
          )}
          <Link to="/reports" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
            <BarChart3 className="h-4 w-4" />
            דוחות מפורטים
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border">
        <button onClick={() => setTab("overview")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === "overview" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          סקירה כללית
        </button>
        <button onClick={() => setTab("phones")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition flex items-center gap-2 ${tab === "phones" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <Phone className="h-4 w-4" />לפי מספר פונה
        </button>
      </div>

      {tab === "overview" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <KpiCard label="נפתחו השבוע" value={data.kpis.openedThisWeek} icon={<Plus className="h-5 w-5" />} tone="emerald" />
            <KpiCard label="נסגרו השבוע" value={data.kpis.closedThisWeek} icon={<CheckCircle2 className="h-5 w-5" />} tone="sky" />
            <KpiCard label="ממתינות לבדיקה" value={data.kpis.pending} icon={<Clock className="h-5 w-5" />} tone="amber" />
            <KpiCard label="מעקבים באיחור" value={data.kpis.overdueReminders} icon={<AlertTriangle className="h-5 w-5" />} tone="red" />
            <KpiCard label="נפתחו החודש" value={data.kpis.openedThisMonth} icon={<TrendingUp className="h-5 w-5" />} tone="violet" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Per-agent performance */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-lg font-semibold mb-4">ביצועים לפי נציג (7 ימים אחרונים)</h2>
              {data.agentPerformance.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">אין פעילות השבוע</div>
              ) : (
                <div className="space-y-3">
                  {data.agentPerformance.map((a) => (
                    <div key={a.agent_id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{a.agent_name}</span>
                        <span className="text-muted-foreground">{a.actions} פעולות</span>
                      </div>
                      <div className="h-2 bg-muted rounded">
                        <div className="h-full bg-primary rounded transition-all" style={{ width: `${(a.actions / maxPerf) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Overdue reminders list */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                מעקבים באיחור
              </h2>
              {data.overdueList.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">אין מעקבים באיחור</div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {data.overdueList.map((s: any) => {
                    const date = new Date(s.reminder_at);
                    const daysOverdue = Math.floor((Date.now() - date.getTime()) / 86400000);
                    return (
                      <Link key={s.id} to="/systems/$id" params={{ id: s.id }}
                        className="block border border-border rounded-lg p-3 hover:bg-accent transition">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{s.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{s.system_code}</div>
                            <div className="text-xs text-muted-foreground mt-1">נציג: {s.agent_name}</div>
                          </div>
                          <div className="text-left shrink-0">
                            <div className="text-xs text-red-700 font-semibold">{daysOverdue} ימים</div>
                            <div className="text-xs text-muted-foreground">{date.toLocaleDateString("he-IL")}</div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "phones" && <CallerPhoneGroupsPanel />}

      {showSeries && <SeriesScannerModal onClose={() => setShowSeries(false)} />}
      {showPendingMessages && <PendingMessagesModal onClose={() => setShowPendingMessages(false)} />}
    </div>
  );
}

// ============= Caller-phone groups (systems sharing the same caller phone) =============
function CallerPhoneGroupsPanel() {
  const fn = useServerFn(getSystemsByCallerPhone);
  const [q, setQ] = useState("");
  const [openPhone, setOpenPhone] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["caller_phone_groups"],
    queryFn: async () => fn({ headers: await getAuthHeaders() }),
    staleTime: 60_000,
  });

  if (isLoading || !data) return <div className="text-center py-10 text-muted-foreground">טוען...</div>;

  const filtered = q.trim()
    ? data.filter((g) => g.phone.includes(q.trim()) || g.systems.some((s: any) => (s.name ?? "").includes(q.trim()) || (s.system_code ?? "").includes(q.trim())))
    : data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מספר / שם מערכת..."
            className="w-full pr-9 pl-3 py-2 rounded-lg border border-input bg-background text-sm" />
        </div>
        <div className="text-sm text-muted-foreground">
          {filtered.length} מספרים עם יותר ממערכת אחת
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
          לא נמצאו מספרי פונה משותפים למספר מערכות
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr className="text-right">
                <th className="px-4 py-3 font-medium text-muted-foreground">מספר פונה</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">מספר מערכות</th>
                <th className="px-4 py-3 font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const isOpen = openPhone === g.phone;
                return (
                  <Fragment key={g.phone}>
                    <tr key={g.phone} className="border-b border-border last:border-0 hover:bg-accent/50 cursor-pointer"
                      onClick={() => setOpenPhone(isOpen ? null : g.phone)}>
                      <td className="px-4 py-3 font-mono" dir="ltr">
                        <a href={`tel:${g.phone}`} onClick={(e) => e.stopPropagation()}
                          className="text-primary hover:underline inline-flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />{g.phone}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center min-w-8 h-7 px-2 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {g.count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left text-xs text-muted-foreground">
                        {isOpen ? "הסתר" : "הצג"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${g.phone}-details`} className="border-b border-border bg-muted/20">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {g.systems.map((s: any) => (
                              <Link key={s.id} to="/systems/$id" params={{ id: s.id }}
                                className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border bg-card hover:bg-accent transition">
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{s.name || "—"}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{s.system_code}</div>
                                </div>
                                <div className="text-xs text-muted-foreground shrink-0">
                                  {STATUS_LABEL[s.status as keyof typeof STATUS_LABEL] ?? s.status}
                                </div>
                              </Link>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============= Voice Messages Queue Panel (pending sends + manual override) =============
function VoiceQueuePanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPendingVoiceSends);
  const sendNowFn = useServerFn(manualSendPendingVoice);
  const rescheduleFn = useServerFn(rescheduleVoicePending);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["voice_queue"],
    queryFn: async () => listFn({ headers: await getAuthHeaders() }),
    refetchInterval: 30000,
  });

  const sendNowMut = useMutation({
    mutationFn: async (systemId: string) => sendNowFn({ data: { systemId }, headers: await getAuthHeaders() }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["voice_queue"] });
      if (res?.fail > 0) toast.error(`נשלחו ${res.ok}, נכשלו ${res.fail}`);
      else toast.success(`נשלח ל-${res?.ok ?? 0} נמענים`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rescheduleMut = useMutation({
    mutationFn: async (v: { systemId: string; sendAt: string | null }) => rescheduleFn({ data: v, headers: await getAuthHeaders() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["voice_queue"] }); toast.success("זמן השליחה עודכן"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return null;

  const pending = data?.pending || [];
  const sentToday = data?.sent_today || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-card border border-border p-5 rounded-xl shadow-sm">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-primary" />
            תור הודעות קוליות ממתינות ({pending.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            הודעות שנוצרו מחוץ לשעות השליחה המוגדרות בסטטוסים וממתינות לזמן השליחה שלהן. אפשר לשלוח כל אחת מיידית באופן ידני.
          </p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent transition-colors">
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          רענן
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr className="text-right">
              <th className="px-4 py-3 font-medium text-muted-foreground">קוד מערכת</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">טלפון נמען</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">סטטוס נוכחי</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">מתוזמן לשעה</th>
              <th className="px-4 py-3 font-medium text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pending.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground italic">אין הודעות ממתינות בתור כרגע.</td></tr>
            ) : (
              pending.map((msg: any) => (
                <tr key={msg.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold">
                    <Link to="/systems/$id" params={{ id: msg.id }} className="hover:underline">{msg.system_code}</Link>
                  </td>
                  <td className="px-4 py-3 font-mono" dir="ltr">{msg.caller_phone}</td>
                  <td className="px-4 py-3"><span className="text-xs font-medium">{msg.status_label}</span></td>
                  <td className="px-4 py-3">
                    <input
                      type="datetime-local"
                      defaultValue={msg.pending_voice_send_at ? toLocalInputValue(msg.pending_voice_send_at) : ""}
                      onBlur={(e) => {
                        const v = e.target.value;
                        const iso = v ? new Date(v).toISOString() : null;
                        if (iso !== msg.pending_voice_send_at) {
                          rescheduleMut.mutate({ systemId: msg.id, sendAt: iso });
                        }
                      }}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs w-40"
                    />
                  </td>
                  <td className="px-4 py-3 text-left">
                    <button
                      disabled={sendNowMut.isPending}
                      onClick={() => sendNowMut.mutate(msg.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50">
                      <Send className="h-3 w-3" />שלח עכשיו
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {sentToday.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground px-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            נשלחו היום ({sentToday.length})
          </h3>
          <div className="bg-card border border-border rounded-xl opacity-80 overflow-hidden">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {sentToday.map((msg: any) => (
                  <tr key={msg.id} className="bg-muted/10">
                    <td className="px-4 py-2 font-mono w-32 font-medium">{msg.system_code}</td>
                    <td className="px-4 py-2 w-40">{msg.caller_phone}</td>
                    <td className="px-4 py-2 text-muted-foreground italic">
                      נשלח ב-{new Date(msg.voice_message_sent_at).toLocaleTimeString("he-IL")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Modal wrapper around the pending voice-messages queue, opened from the
// managers' dashboard the same way "השלמת סדרות" opens — a focused modal
// rather than a panel sitting permanently on the main dashboard screen.
function PendingMessagesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-auto">
        <div className="p-5 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">הודעות ממתינות</h2>
            <p className="text-sm text-muted-foreground mt-1">
              הודעות קוליות שממתינות לשליחה, עם אפשרות לשלוח כל אחת מיידית באופן ידני או לשנות את זמן השליחה.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">
          <VoiceQueuePanel />
        </div>
      </div>
    </div>
  );
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function KpiCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "emerald" | "sky" | "amber" | "red" | "violet" }) {
  const toneCls: Record<string, string> = {
    emerald: "bg-emerald-50 border-emerald-300 text-emerald-900",
    sky: "bg-sky-50 border-sky-300 text-sky-900",
    amber: "bg-amber-50 border-amber-300 text-amber-900",
    red: "bg-red-50 border-red-300 text-red-900",
    violet: "bg-violet-50 border-violet-300 text-violet-900",
  };
  return (
    <div className={`border rounded-xl p-4 ${toneCls[tone]}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm opacity-80">{label}</div>
        <div className="opacity-70">{icon}</div>
      </div>
      <div className="text-3xl font-bold mt-2">{value}</div>
    </div>
  );
}

// Scans every existing system_code, groups by common prefix, and lists the
// numeric gaps. The admin picks which missing codes to create (and at what
// status) and this fires off `createMissingSystems` with the selection.
function SeriesScannerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const scanFn = useServerFn(scanSystemSeries);
  const createFn = useServerFn(createMissingSystems);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ series: any[]; settings: any } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("open");
  const [namePrefix, setNamePrefix] = useState("מערכת");

  async function scan() {
    setBusy(true);
    try {
      const res: any = await scanFn();
      setResult(res);
      setSelected(new Set());
      if (!res.series.length) toast.info("לא נמצאו סדרות עם מערכות חסרות");
      else toast.success(`נמצאו ${res.series.length} סדרות עם חוסרים`);
    } catch (e: any) {
      toast.error(e?.message ?? "הסריקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });
  }
  function toggleGroup(missing: string[]) {
    setSelected((prev) => {
      const n = new Set(prev);
      const allSelected = missing.every((c) => n.has(c));
      for (const c of missing) { if (allSelected) n.delete(c); else n.add(c); }
      return n;
    });
  }

  async function createSelected() {
    if (selected.size === 0) { toast.info("בחר לפחות מזהה אחד ליצירה"); return; }
    if (selected.size > 500) { toast.error("ניתן ליצור עד 500 מערכות בכל פעם"); return; }
    setBusy(true);
    try {
      const res: any = await createFn({ data: { codes: Array.from(selected), namePrefix: namePrefix.trim() || "מערכת", status } });
      toast.success(`נוצרו ${res.createdCount} מערכות`);
      qc.invalidateQueries({ queryKey: ["systems"] });
      qc.invalidateQueries({ queryKey: ["statusCounts"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "היצירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto">
        <div className="p-5 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">השלמת סדרות מזהים</h2>
            <p className="text-sm text-muted-foreground mt-1">
              המערכת סורקת את כל המזהים הקיימים ומזהה סדרות לפי ההגדרות ב'ניהול'. ליד כל סדרה מוצגים המזהים החסרים.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={scan}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {busy ? "סורק..." : "סרוק מערכת לזיהוי"}
            </button>
            {result && (
              <span className="text-xs text-muted-foreground">
                הגדרות נוכחיות: {(result.settings?.modes ?? []).map((m: any) => `${m.strip} ספרות ≥ ${m.min}`).join(" · ")}
              </span>
            )}
          </div>

          {result && result.series.length === 0 && (
            <div className="text-center text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg py-6 text-sm font-medium">
              אין סדרות עם מערכות חסרות.
            </div>
          )}

          {result && result.series.length > 0 && (
            <>
              <div className="space-y-3">
                {result.series.map((s: any) => {
                  const allSel = s.missing.every((c: string) => selected.has(c));
                  return (
                    <div key={`${s.prefix}-${s.strip}`} className="border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between gap-2 bg-muted/40 p-3">
                        <div className="text-sm">
                          <div className="font-semibold">סדרה: <span className="font-mono">{s.prefix}…</span> ({s.strip} ספרות מזהות)</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {s.count} מערכות קיימות · טווח <span className="font-mono">{s.min}</span> – <span className="font-mono">{s.max}</span> · חסרות <span className="font-bold text-red-700">{s.missing.length}</span>
                          </div>
                        </div>
                        <button onClick={() => toggleGroup(s.missing)}
                          className="text-xs px-2 py-1 rounded border border-input bg-white hover:bg-accent shrink-0">
                          {allSel ? "בטל בחירה" : "בחר הכל"}
                        </button>
                      </div>

                      {Array.isArray(s.existing) && s.existing.length > 0 && (
                        <div className="border-b border-border bg-background">
                          <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground bg-muted/20">
                            מערכות קיימות בסדרה ({s.existing.length}):
                          </div>
                          <div className="max-h-48 overflow-y-auto divide-y divide-border/60">
                            {s.existing.map((ex: any) => (
                              <div key={ex.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="font-mono text-muted-foreground shrink-0">{ex.code}</span>
                                  <span className="truncate font-medium" title={ex.name}>{ex.name}</span>
                                  <span className="shrink-0 px-1.5 py-0.5 rounded border text-[10px]"
                                    style={{ borderColor: "var(--border)" }}>
                                    {STATUS_LABEL[ex.status] ?? ex.status}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <a href={`tel:${buildDialNumber(ex.code)}`}
                                    className="px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                    title="חייג לבדיקת סטטוס">חייג</a>
                                  <Link to="/systems/$id" params={{ id: ex.id }}
                                    className="px-2 py-0.5 rounded border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
                                    title="פתח כרטיס מערכת">פתח</Link>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
                        {s.missing.map((code: string) => {
                          const on = selected.has(code);
                          const dialed = dialedCodes.has(code);
                          return (
                            <div key={code}
                              className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 ${dialed ? "bg-muted/40 border-border" : "bg-red-50 border-red-200"}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-xs">{code}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dialed ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                                  {dialed ? "חויג" : "טרם חויג"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <a href={`tel:${buildDialNumber(code)}`} onClick={() => markDialed(code)}
                                  className="px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-xs"
                                  title="חייג למספר זה">חייג</a>
                                <button onClick={() => toggleDialed(code)}
                                  className="px-2 py-0.5 rounded border border-input bg-background hover:bg-accent text-xs"
                                  title="סמן/בטל סימון כחויג">{dialed ? "בטל סימון" : "סמן כחויג"}</button>
                                <button onClick={() => toggle(code)}
                                  className={`px-2 py-0.5 rounded border text-xs ${on ? "bg-emerald-600 text-white border-emerald-700" : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"}`}
                                  title="בחר האם לפתוח מערכת למספר זה">{on ? "נבחר לפתיחה ✓" : "פתח מערכת"}</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  );
                })}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border">
                <label className="text-sm space-y-1">
                  <span className="font-medium">שם בסיס למערכות שייווצרו</span>
                  <input value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                </label>
                <label className="text-sm space-y-1">
                  <span className="font-medium">סטטוס לפתיחה</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="text-sm">
                  נבחרו לפתיחה: <span className="font-bold">{selected.size}</span>
                </div>
                <button disabled={busy || selected.size === 0} onClick={createSelected}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">
                  {busy ? "יוצר..." : "צור את הנבחרים"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
