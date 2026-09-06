import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Headphones, Inbox, Play, Plus, RefreshCw, ShieldQuestion, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listSystemRequests, decideSystemRequest, getRequestAutomationSettings, getRequestAudio,
  setRequestSystemCode, repairUnlinkedRequests,
} from "@/lib/system-requests.functions";
import { getMyRole } from "@/lib/admin.functions";
import { useStatusSettings } from "@/lib/use-status-settings";

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
  kept: "טופלה ללא שינוי סטטוס",
  ignored: "התעלמות",
  simulated: "הרצת בדיקה — הוכרע ולא בוצע",
  duplicate: "כפילות של בקשה קיימת",
};

const ACTION_LABELS: Record<string, string> = {
  set_status: "שינוי סטטוס",
  keep: "השארה ללא שינוי",
  needs_decision: "העברה להחלטה ידנית",
  ignore: "התעלמות",
  create_system: "יצירת מערכת חדשה",
};

const MODE_LABELS: Record<string, string> = {
  off: "כבוי",
  dry_run: "מצב בדיקה (ללא שינויים)",
  live: "פעיל",
};

// What the row says about the moment it was ingested — the request stores the
// automation mode that was in effect back then.
const ROW_MODE_NOTE: Record<string, string> = {
  off: "האוטומציה הייתה כבויה בזמן קליטת הבקשה",
  dry_run: "הרצת בדיקה — שום שינוי לא בוצע בפועל",
  live: "האוטומציה הייתה פעילה בזמן קליטת הבקשה",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

type DecideVars = { id: string; action: "apply" | "keep" | "ignore" | "create_system"; toStatus?: string | null };

function RequestsPage() {
  const qc = useQueryClient();
  const [onlyPending, setOnlyPending] = useState(true);
  const fetchList = useServerFn(listSystemRequests);
  const fetchSettings = useServerFn(getRequestAutomationSettings);
  const decide = useServerFn(decideSystemRequest);
  const fetchAudio = useServerFn(getRequestAudio);
  const fixCode = useServerFn(setRequestSystemCode);
  const repair = useServerFn(repairUnlinkedRequests);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const { rows: statusRows } = useStatusSettings();

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["system-requests"] });
    qc.invalidateQueries({ queryKey: ["systems"] });
    qc.invalidateQueries({ queryKey: ["requests", "pending-count"] });
  };

  const decideMutation = useMutation({
    mutationFn: (vars: DecideVars) => decide({ data: vars }),
    onSuccess: (res: any) => {
      if (res?.linkedExisting) toast.success("המערכת כבר קיימת — הבקשה שויכה אליה. בחר סטטוס להמשך");
      else if (res?.multipleMatches) toast.warning("נמצאה יותר ממערכת אחת עם מספר זה — יש לשייך ידנית");
      else toast.success(res?.alreadyDecided ? "הבקשה כבר טופלה" : "הבקשה טופלה");
      invalidate();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const repairMutation = useMutation({
    mutationFn: () => repair({}),
    onSuccess: (res: any) => {
      toast.success(`שויכו ${res?.linked ?? 0} בקשות מתוך ${res?.scanned ?? 0} שנבדקו`);
      invalidate();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const codeMutation = useMutation({
    mutationFn: (vars: { id: string; systemCode: string }) => fixCode({ data: vars }),
    onSuccess: (res: any) => {
      toast.success(res?.matched ? "מספר המערכת עודכן והבקשה שויכה" : "מספר המערכת עודכן (לא נמצאה מערכת קיימת)");
      invalidate();
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
            החלטה ידנית במסך הזה מתבצעת בפועל בכל מצב.{" "}
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
          {rows.map((r) => (
            <RequestCard
              key={r.id}
              row={r}
              statuses={statusRows ?? []}
              canDecide={canDecide}
              busy={decideMutation.isPending || codeMutation.isPending}
              audio={audio}
              audioPending={audioMutation.isPending}
              onPlay={() => audioMutation.mutate(r.id)}
              onDecide={(vars) => decideMutation.mutate(vars)}
              onFixCode={(systemCode) => codeMutation.mutate({ id: r.id, systemCode })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestCard({
  row: r, statuses, canDecide, busy, audio, audioPending, onPlay, onDecide, onFixCode,
}: {
  row: any;
  statuses: Array<{ status_key: string; label: string }>;
  canDecide: boolean;
  busy: boolean;
  audio: { id: string; url: string } | null;
  audioPending: boolean;
  onPlay: () => void;
  onDecide: (vars: DecideVars) => void;
  onFixCode: (systemCode: string) => void;
}) {
  // A dry-run simulation was never applied, so it can still be acted on.
  const pending = r.decision_status === "needs_decision" || r.decision_status === "simulated";
  const hasSystem = Boolean(r.system_id);
  const hasCode = Boolean(r.system_code_norm);
  const label = (key?: string | null) =>
    (key && statuses.find((s) => s.status_key === key)?.label) || key || "—";

  const [choice, setChoice] = useState<string>(r.proposed_status ?? "");
  const [codeDraft, setCodeDraft] = useState<string>(r.system_code_raw ?? "");
  const mode = (r.automation_mode as string | null) ?? (r.dry_run ? "dry_run" : null);

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={`rounded-md px-2 py-0.5 text-xs ${
            r.request_type === "pticha" ? "bg-emerald-500/15 text-emerald-700"
              : r.request_type === "sgira" ? "bg-rose-500/15 text-rose-700"
              : "bg-amber-500/15 text-amber-700"}`}>
            {r.request_type === "pticha" ? "בקשת פתיחה"
              : r.request_type === "sgira" ? "בקשת סגירה"
              : "סוג בקשה לא זוהה"}
          </span>
          {r.system ? (
            <Link to="/systems/$id" params={{ id: r.system_id }} className="underline">
              {r.system.system_code} · {r.system.name}
            </Link>
          ) : hasCode ? (
            <span className="text-amber-700">מערכת {r.system_code_raw ?? r.system_code_norm} — המערכת אינה קיימת</span>
          ) : (
            <span className="text-muted-foreground">לא זוהה מספר מערכת</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{fmt(r.received_at)}</span>
      </div>

      <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>מספר בקשה: {r.request_number || "—"}</span>
        <span>טלפון פונה: {r.caller_phone || "—"}</span>
        <span>סטטוס נוכחי: {hasSystem ? label(r.system?.status ?? r.prev_status) : "אין מערכת"}</span>
        <span>סטטוס מוצע: {r.proposed_status ? label(r.proposed_status) : "—"}</span>
        <span>מצב: {DECISION_LABELS[r.decision_status] ?? r.decision_status ?? "בעיבוד"}</span>
        {r.proposed_action && (
          <span>פעולה שהכלל קבע: {ACTION_LABELS[r.proposed_action] ?? r.proposed_action}</span>
        )}
        {mode && ROW_MODE_NOTE[mode] && (
          <span className={mode === "live" ? "" : "font-medium text-amber-700"}>{ROW_MODE_NOTE[mode]}</span>
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
            <Button size="sm" variant="outline" disabled={audioPending} onClick={onPlay}>
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
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {hasCode ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  בחירת סטטוס
                  <select
                    value={choice}
                    onChange={(e) => setChoice(e.target.value)}
                    className="min-w-52 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value="">— בחר סטטוס —</option>
                    {statuses.map((s) => (
                      <option key={s.status_key} value={s.status_key}>{s.label}</option>
                    ))}
                  </select>
                </label>
                {hasSystem ? (
                  <Button size="sm" disabled={!choice || busy}
                    onClick={() => onDecide({ id: r.id, action: "apply", toStatus: choice })}>
                    <Play className="size-4" />
                    החל סטטוס {choice ? `"${label(choice)}"` : ""}
                  </Button>
                ) : (
                  <Button size="sm" disabled={!choice || busy}
                    onClick={() => onDecide({ id: r.id, action: "create_system", toStatus: choice })}>
                    <Plus className="size-4" />
                    צור מערכת בסטטוס {choice ? `"${label(choice)}"` : ""}
                  </Button>
                )}
                {hasSystem && (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => onDecide({ id: r.id, action: "keep" })}>
                    השאר ללא שינוי
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => onDecide({ id: r.id, action: "ignore" })}>
                  <SkipForward className="size-4" />
                  התעלם
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                "השאר ללא שינוי" מסמן את הבקשה כטופלה בלי לשנות סטטוס, ומוסיף את מספר הפונה אם הוא חסר.
                "התעלם" לא משנה דבר בכרטיס המערכת.
              </p>
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                מספר מערכת (רשומה ישנה ללא מספר)
                <input value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)}
                  className="w-44 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
              </label>
              <Button size="sm" variant="outline" disabled={!codeDraft.trim() || busy}
                onClick={() => onFixCode(codeDraft.trim())}>
                שמור מספר מערכת
              </Button>
              <Button size="sm" variant="ghost" disabled={busy}
                onClick={() => onDecide({ id: r.id, action: "ignore" })}>
                <SkipForward className="size-4" />
                התעלם
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
