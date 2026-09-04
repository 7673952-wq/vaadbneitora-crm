import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Headphones, Inbox, Play, RefreshCw, ShieldQuestion, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listSystemRequests, decideSystemRequest, getRequestAutomationSettings, getRequestAudio,
} from "@/lib/system-requests.functions";
import { getMyRole } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/requests")({
  component: RequestsPage,
  head: () => ({
    meta: [
      { title: "בקשות פתיחה וסגירה | תור דורש החלטה" },
      { name: "description", content: "תור הבקשות האוטומטיות מהמייל: פתיחה וסגירה של מערכות, עם החלטה ידנית על כל בקשה שלא טופלה אוטומטית." },
      { property: "og:title", content: "בקשות פתיחה וסגירה | תור דורש החלטה" },
      { property: "og:description", content: "ניהול בקשות פתיחה וסגירה שהתקבלו במייל, כולל מצב בדיקה והחלטה ידנית." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const DECISION_LABELS: Record<string, string> = {
  needs_decision: "דורש החלטה",
  auto_applied: "עודכן אוטומטית",
  manual_applied: "עודכן ידנית",
  kept: "הושאר ללא שינוי",
  ignored: "התעלמות",
  simulated: "הרצת בדיקה — הוכרע ולא בוצע",
};

const ACTION_LABELS: Record<string, string> = {
  set_status: "שינוי סטטוס",
  keep: "השארה ללא שינוי",
  needs_decision: "העברה להחלטה ידנית",
  ignore: "התעלמות",
};

const MODE_LABELS: Record<string, string> = {
  off: "כבוי",
  dry_run: "מצב בדיקה (ללא שינויים)",
  live: "פעיל",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

function RequestsPage() {
  const qc = useQueryClient();
  const [onlyPending, setOnlyPending] = useState(true);
  const fetchList = useServerFn(listSystemRequests);
  const fetchSettings = useServerFn(getRequestAutomationSettings);
  const decide = useServerFn(decideSystemRequest);
  const fetchAudio = useServerFn(getRequestAudio);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);

  // Permissions: the server enforces them too — this only hides what the user
  // cannot do. `requests_decide` already implies `requests_view` server-side.
  const meFn = useServerFn(getMyRole);
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["my-role"], queryFn: async () => meFn({}) });
  const perms = ((me as any)?.permissions ?? {}) as Record<string, boolean>;
  const isSuper = Boolean((me as any)?.isSuperAdmin);
  const canView = isSuper || perms.requests_view === true;
  const canDecide = isSuper || (perms.requests_view === true && perms.requests_decide === true);
  const canManage = isSuper || (perms.requests_view === true && perms.requests_manage === true);

  // Recordings are streamed from Gmail on demand and never stored in the CRM.
  const audioMutation = useMutation({
    mutationFn: (id: string) => fetchAudio({ data: { id } }),
    onSuccess: (res: any, id) => setAudio({ id, url: res.dataUrl }),
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const settings = useQuery({
    queryKey: ["request-automation-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 60_000,
    enabled: canView,
  });

  const list = useQuery({
    queryKey: ["system-requests", onlyPending],
    queryFn: () => fetchList({ data: { decision: onlyPending ? "needs_decision" : null, limit: 100 } }),
    refetchInterval: 60_000,
    enabled: canView,
  });

  const decideMutation = useMutation({
    mutationFn: (vars: { id: string; action: "apply" | "keep" | "ignore"; toStatus?: string | null }) =>
      decide({ data: vars }),
    onSuccess: (res: any) => {
      toast.success(res?.alreadyDecided ? "הבקשה כבר טופלה" : "הבקשה טופלה");
      qc.invalidateQueries({ queryKey: ["system-requests"] });
      qc.invalidateQueries({ queryKey: ["systems"] });
      qc.invalidateQueries({ queryKey: ["requests", "pending-count"] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const rows = (list.data ?? []) as any[];
  const pendingCount = useMemo(
    () => rows.filter((r) => r.decision_status === "needs_decision").length,
    [rows],
  );

  if (meLoading) {
    return <div dir="rtl" className="py-16 text-center text-sm text-muted-foreground">טוען…</div>;
  }
  if (!canView) {
    return (
      <div dir="rtl" className="mx-auto max-w-lg px-4 py-16 text-center space-y-2">
        <ShieldQuestion className="mx-auto size-7 text-muted-foreground" />
        <h1 className="text-lg font-semibold">אין הרשאה לצפייה בבקשות</h1>
        <p className="text-sm text-muted-foreground">נדרשת הרשאת "צפייה בבקשות". פנה למנהל המערכת.</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="mx-auto w-full max-w-6xl px-4 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="size-6 text-primary" />
            בקשות פתיחה וסגירה
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            בקשות שהתקבלו במייל, שויכו למערכת ועברו את מנוע הכללים.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium">
            מצב אוטומציה: {MODE_LABELS[settings.data?.mode ?? "dry_run"] ?? "—"}
          </span>
          <Button variant="outline" size="sm" onClick={() => list.refetch()} disabled={list.isFetching}>
            <RefreshCw className={`size-4 ${list.isFetching ? "animate-spin" : ""}`} />
            רענון
          </Button>
        </div>
      </header>

      {settings.data?.mode !== "live" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <span>
            {settings.data?.mode === "dry_run"
              ? "במצב בדיקה המערכת מחשבת ושומרת מה הייתה מבצעת, אך אינה מבצעת את השינוי אוטומטית. רק מקרים שלא ניתן היה להכריע בהם מופיעים בתור 'דורש החלטה'. "
              : "האוטומציה כבויה, ולכן אף סטטוס לא משתנה מעצמו. הבקשות נרשמות בלבד. "}
            {canManage
              ? <>ניתן לשנות את המצב במסך <Link to="/admin" className="underline font-medium">ניהול</Link>.</>
              : "שינוי המצב מחייב הרשאת ניהול אוטומציה."}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <Button variant={onlyPending ? "default" : "outline"} size="sm" onClick={() => setOnlyPending(true)}>
          דורש החלטה{pendingCount ? ` (${pendingCount})` : ""}
        </Button>
        <Button variant={!onlyPending ? "default" : "outline"} size="sm" onClick={() => setOnlyPending(false)}>
          כל הבקשות
        </Button>
      </div>

      {list.isLoading ? (
        <div className="py-12 text-center text-muted-foreground text-sm">טוען בקשות…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 size-6 text-emerald-500" />
          אין בקשות להצגה.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            // A dry-run simulation was never applied, so it can still be acted on.
            const pending = r.decision_status === "needs_decision" || r.decision_status === "simulated";
            return (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${r.request_type === "pticha" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700"}`}>
                      {r.request_type === "pticha" ? "בקשת פתיחה" : "בקשת סגירה"}
                    </span>
                    {r.system ? (
                      <Link to="/systems/$id" params={{ id: r.system_id }} className="underline">
                        {r.system.system_code} · {r.system.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {r.system_code_raw ? `מערכת ${r.system_code_raw} (לא שויכה)` : "לא זוהתה מערכת"}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{fmt(r.received_at)}</span>
                </div>

                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>מספר בקשה: {r.request_number || "—"}</span>
                  <span>טלפון פונה: {r.caller_phone || "—"}</span>
                  <span>סטטוס נוכחי: {r.system?.status ?? r.prev_status ?? "—"}</span>
                  <span>סטטוס מוצע: {r.proposed_status || "—"}</span>
                  <span>מצב: {DECISION_LABELS[r.decision_status] ?? r.decision_status ?? "בעיבוד"}</span>
                  {r.proposed_action && (
                    <span>פעולה שהכלל קבע: {ACTION_LABELS[r.proposed_action] ?? r.proposed_action}</span>
                  )}
                  {r.dry_run && (
                    <span className="font-medium text-amber-700">
                      הרצת בדיקה — שום שינוי לא בוצע בפועל
                    </span>
                  )}
                </div>

                {r.last_error && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                    <ShieldQuestion className="size-3.5" /> {r.last_error}
                  </p>
                )}

                {r.attachment_name && (
                  <div className="mt-3">
                    {audio && audio.id === r.id ? (
                      <audio controls autoPlay src={audio.url} className="w-full max-w-sm" />
                    ) : (
                      <Button size="sm" variant="outline" disabled={audioMutation.isPending}
                        onClick={() => audioMutation.mutate(r.id)}>
                        <Headphones className="size-4" />
                        השמע הקלטה
                      </Button>
                    )}
                  </div>
                )}

                {pending && !canDecide && (
                  <p className="mt-3 text-xs text-muted-foreground">אין לך הרשאת טיפול בבקשות.</p>
                )}

                {pending && canDecide && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!r.system_id || !r.proposed_status || decideMutation.isPending}
                      onClick={() => decideMutation.mutate({ id: r.id, action: "apply" })}
                    >
                      <Play className="size-4" />
                      {r.proposed_status ? `החל סטטוס "${r.proposed_status}"` : "אין סטטוס מוצע"}
                    </Button>
                    <Button
                      size="sm" variant="outline" disabled={decideMutation.isPending}
                      onClick={() => decideMutation.mutate({ id: r.id, action: "keep" })}
                    >
                      השאר ללא שינוי
                    </Button>
                    <Button
                      size="sm" variant="ghost" disabled={decideMutation.isPending}
                      onClick={() => decideMutation.mutate({ id: r.id, action: "ignore" })}
                    >
                      <SkipForward className="size-4" />
                      התעלם
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
