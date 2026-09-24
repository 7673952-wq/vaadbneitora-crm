import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Headphones, Inbox, Pencil, Play, Plus, RefreshCw, RotateCcw, ShieldQuestion, SkipForward, Trash2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listSystemRequests, decideSystemRequest, getRequestAutomationSettings, getRequestAudio,
  setRequestSystemCode, repairUnlinkedRequests, renameRequestSystem, matchRequestSystemName,
  getSystemRequestById, deleteSystemRequest, restoreSystemRequest,
} from "@/lib/system-requests.functions";

import { getMyRole } from "@/lib/admin.functions";
import { useStatusSettings } from "@/lib/use-status-settings";

export const Route = createFileRoute("/_authenticated/requests")({
  component: RequestsPage,
  validateSearch: (search: Record<string, unknown>): { req?: string } => {
    const req = typeof search.req === "string" && search.req ? search.req : undefined;
    return req ? { req } : {};
  },
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

// A valid Postgres UUID — used to filter out the virtual-category placeholder
// id before it is ever sent to the server (whose confirmedMatches schema only
// accepts real uuids).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

type DecideVars = {
  id: string; action: "apply" | "keep" | "ignore" | "create_system"; toStatus?: string | null; name?: string | null;
  systemAction?: "link_existing" | "create_sub" | "create_root" | null;
  targetSystemId?: string | null; parentSystemId?: string | null; confirmedMatches?: string[] | null;
};

function RequestsPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const focusReqId = search.req;
  const [view, setView] = useState<"pending" | "all" | "deleted">("pending");
  const onlyPending = view === "pending";

  const fetchList = useServerFn(listSystemRequests);
  const fetchSettings = useServerFn(getRequestAutomationSettings);
  const decide = useServerFn(decideSystemRequest);
  const fetchAudio = useServerFn(getRequestAudio);
  const fixCode = useServerFn(setRequestSystemCode);
  const repair = useServerFn(repairUnlinkedRequests);
  const rename = useServerFn(renameRequestSystem);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const { rows: statusRows } = useStatusSettings();
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const [scrolledTo, setScrolledTo] = useState<string | null>(null);

  // Permissions: the server enforces them too — this only hides what the user
  // cannot do. `requests_decide` already implies `requests_view` server-side.
  const meFn = useServerFn(getMyRole);
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["my-role"], queryFn: async () => meFn({}) });
  const perms = ((me as any)?.permissions ?? {}) as Record<string, boolean>;
  const isSuper = Boolean((me as any)?.isSuperAdmin);
  const canView = isSuper || perms.requests_view === true;
  const canDecide = isSuper || (perms.requests_view === true && perms.requests_decide === true);
  const canManage = isSuper || (perms.requests_view === true && perms.requests_manage === true);
  const canDelete = isSuper || (perms.requests_view === true && perms.requests_delete === true);

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
    queryKey: ["system-requests", view],
    // "open" = never decided AND decided-in-test-mode; both still need a human.
    queryFn: () => fetchList({
      data: view === "deleted"
        ? { decision: null, limit: 100, includeDeleted: true }
        : { decision: onlyPending ? "open" : null, limit: 100 },
    }),
    refetchInterval: 60_000,
    enabled: canView,
  });

  // Deep-link: a request reached from a system card may be decided, or simply
  // outside the current filter/page — so it is fetched on its own and shown at
  // the top, instead of silently landing on an unrelated list.
  const fetchOne = useServerFn(getSystemRequestById);
  const focused = useQuery({
    queryKey: ["system-requests", "one", focusReqId],
    queryFn: () => fetchOne({ data: { id: focusReqId as string, includeDeleted: true } }),
    enabled: canView && Boolean(focusReqId),
    staleTime: 30_000,
  });


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["system-requests"] });
    qc.invalidateQueries({ queryKey: ["systems"] });
    qc.invalidateQueries({ queryKey: ["requests", "pending-count"] });
  };

  const decideMutation = useMutation({
    mutationFn: (vars: DecideVars) => decide({ data: vars }),
    onSuccess: (res: any) => {
      // A request that lost the race did NOT carry out the action — never
      // report it as done.
      if (res?.ok === false) {
        toast.warning(String(res?.message ?? "הבקשה לא בוצעה — רענן ונסה שוב"));
        invalidate();
        return;
      }
      if (res?.linkedExisting) toast.success("המערכת כבר קיימת — הבקשה שויכה אליה. בחר סטטוס להמשך");
      else if (res?.multipleMatches) toast.warning("נמצאה יותר ממערכת אחת עם מספר זה — יש לשייך ידנית");
      else toast.success("הבקשה טופלה");
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

  const renameMutation = useMutation({
    mutationFn: (vars: { id: string; name: string }) => rename({ data: vars }),
    onSuccess: () => { toast.success("שם המערכת עודכן"); invalidate(); },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const removeFn = useServerFn(deleteSystemRequest);
  const restoreFn = useServerFn(restoreSystemRequest);
  const deleteMutation = useMutation({
    mutationFn: (vars: { id: string; reason: string | null }) => removeFn({ data: vars }),
    onSuccess: () => { toast.success("הבקשה הועברה לנמחקות"); invalidate(); },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => { toast.success("הבקשה שוחזרה"); invalidate(); },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const listRows = (list.data ?? []) as any[];
  const focusedRow = (focused.data ?? null) as any | null;
  // The deep-linked request always shows first, even when the active filter or
  // the page limit would have hidden it.
  const rows = useMemo(() => {
    if (!focusedRow) return listRows;
    return [focusedRow, ...listRows.filter((r) => r.id !== focusedRow.id)];
  }, [focusedRow, listRows]);
  const pendingCount = useMemo(
    () => listRows.filter((r) => r.decision_status === "needs_decision" || r.decision_status === "simulated" || !r.decision_status).length,
    [listRows],
  );


  // Deep-link focus: ?req=<id> scrolls that row into view and highlights it
  // once the list has loaded it.
  useEffect(() => {
    if (!focusReqId || scrolledTo === focusReqId) return;
    const el = rowRefs.current[focusReqId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setScrolledTo(focusReqId);
    }
  }, [focusReqId, rows, scrolledTo]);

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
          {canDecide && (
            <Button variant="outline" size="sm" disabled={repairMutation.isPending}
              onClick={() => repairMutation.mutate()}>
              <Link2 className="size-4" />
              שייך בקשות למערכות קיימות
            </Button>
          )}
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

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant={view === "pending" ? "default" : "outline"} size="sm" onClick={() => setView("pending")}>
          דורש החלטה{pendingCount ? ` (${pendingCount})` : ""}
        </Button>
        <Button variant={view === "all" ? "default" : "outline"} size="sm" onClick={() => setView("all")}>
          כל הבקשות
        </Button>
        {canDelete && (
          <Button variant={view === "deleted" ? "default" : "outline"} size="sm" onClick={() => setView("deleted")}>
            <Trash2 className="size-4" />
            נמחקו
          </Button>
        )}
      </div>

      {list.isLoading ? (
        <div className="py-12 text-center text-muted-foreground text-sm">טוען בקשות…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 size-6 text-emerald-500" />
          אין בקשות להצגה.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <RequestCard
              key={r.id}
              row={r}
              statuses={statusRows ?? []}
              canDecide={canDecide}
              canDelete={canDelete}
              busy={decideMutation.isPending || codeMutation.isPending || renameMutation.isPending
                || deleteMutation.isPending || restoreMutation.isPending}
              audio={audio}
              audioPending={audioMutation.isPending}
              highlighted={focusReqId === r.id}
              cardRef={(el) => { rowRefs.current[r.id] = el; }}
              onPlay={() => audioMutation.mutate(r.id)}
              onDecide={(vars) => decideMutation.mutate(vars)}
              onDecideAsync={(vars) => decideMutation.mutateAsync(vars)}
              onFixCode={(systemCode) => codeMutation.mutate({ id: r.id, systemCode })}
              onRename={(name) => renameMutation.mutate({ id: r.id, name })}
              onDelete={(reason) => deleteMutation.mutate({ id: r.id, reason })}
              onRestore={() => restoreMutation.mutate(r.id)}
            />
          ))}
        </ul>
      )}

    </div>
  );
}

/** Report description, clamped to ~2 lines with a show more/less toggle.
 * Renders nothing when the request carries no description. */
function ReportDescription({ text }: { text: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <div className="mb-1 font-medium text-foreground">תאור הדיווח</div>
      <p className={`whitespace-pre-wrap break-words text-muted-foreground ${expanded ? "" : "line-clamp-2"}`}>
        {trimmed}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-[11px] font-medium text-primary underline"
      >
        {expanded ? "פחות" : "עוד"}
      </button>
    </div>
  );
}

type MatchOption = { id: string; system_code?: string | null; name: string };

/** The "which system does this request belong to" flow, kept deliberately
 * small: when the typed name already exists, the user gets exactly two
 * choices — open a NEW root system, or open it as a sub-system under one of the
 * matching ROOT systems. Sub-systems sharing the name are never listed.
 * Matching always runs on the server (`matchRequestSystemName`). */
function SystemMatcher({
  requestId, name, disabled, statuses, status, onStatusChange, onDecideAsync,
}: {
  requestId: string;
  name: string;
  disabled: boolean;
  statuses: Array<{ status_key: string; label: string }>;
  status: string;
  onStatusChange: (value: string) => void;
  onDecideAsync: (vars: DecideVars) => Promise<any>;
}) {
  // SHARED picker — the very same hook + component the "הוסף מערכת" modal uses.
  const nameMatch = useSystemNameMatch(name, undefined, { debounceMs: 400 });
  const { matchedParent, createMode, parentOptions } = nameMatch;
  const ensureCategoryRootFn = useServerFn(ensureCategoryRoot);
  const [conflictMatches, setConflictMatches] = useState<Array<{ id: string; name: string; system_code?: string | null }> | null>(null);

  // A new name invalidates any earlier conflict warning.
  useEffect(() => { setConflictMatches(null); }, [name]);

  // One click does everything: name + kind + status are sent together, so the
  // card is created, linked and given its status in a single decision.
  const ready = Boolean(name.trim()) && Boolean(status);
  const willCreateAsSub = Boolean(matchedParent) && createMode === "sub";

  const run = async () => {
    if (!ready) return;
    if (willCreateAsSub && matchedParent) {
      let parentId = matchedParent.id;
      if (parentId === VIRTUAL_PARENT_ID) {
        const root: any = await ensureCategoryRootFn({ data: { name: matchedParent.name } });
        if (!root?.id) throw new Error("לא הצלחתי לוודא את מערכת האב");
        parentId = root.id;
      }
      await onDecideAsync({
        id: requestId, action: "create_system", name: name.trim() || null, toStatus: status,
        systemAction: "create_sub", parentSystemId: parentId,
      });
      setConflictMatches(null);
      return;
    }
    const confirmedMatches = (conflictMatches ?? parentOptions).map((m) => m.id).filter((id) => UUID_RE.test(id));
    const res: any = await onDecideAsync({
      id: requestId, action: "create_system", name: name.trim() || null, toStatus: status,
      systemAction: "create_root", confirmedMatches,
    });
    setConflictMatches(res?.conflict ? (res.matches ?? []) : null);
  };

  return (
    <div className="rounded-md bg-muted/30 p-2.5 space-y-2">
      <SystemNameMatchChoice match={nameMatch} disabled={disabled} />

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        סטטוס המערכת החדשה
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={disabled}
          className="min-w-52 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">— בחר סטטוס —</option>
          {statuses.map((s) => (
            <option key={s.status_key} value={s.status_key}>{s.label}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || !ready || Boolean(nameMatch.error)} onClick={run}>
          <Plus className="size-4" />
          {willCreateAsSub && matchedParent
            ? `פתח תת-מערכת תחת ${matchedParent.name}`
            : conflictMatches ? "אשר ופתח אב-מערכת חדשה" : "פתח אב-מערכת חדשה"}
        </Button>
      </div>

      {!ready && (
        <p className="text-[11px] text-muted-foreground">יש למלא שם מערכת ולבחור סטטוס — הפתיחה והסטטוס יתבצעו בלחיצה אחת.</p>
      )}

      {conflictMatches && conflictMatches.length > 0 && (
        <p className="text-[11px] text-amber-700">
          בזמן הפעולה נמצאה מערכת נוספת בשם זה: {conflictMatches.map((m) => `${m.name}${m.system_code ? ` (${m.system_code})` : ""}`).join(", ")}. לחיצה נוספת תאשר פתיחת מערכת נפרדת.
        </p>
      )}
    </div>
  );
}


function RequestCard({
  row: r, statuses, canDecide, canDelete, busy, audio, audioPending, highlighted, cardRef,
  onPlay, onDecide, onDecideAsync, onFixCode, onRename, onDelete, onRestore,
}: {
  row: any;
  statuses: Array<{ status_key: string; label: string }>;
  canDecide: boolean;
  canDelete: boolean;
  busy: boolean;
  audio: { id: string; url: string } | null;
  audioPending: boolean;
  highlighted: boolean;
  cardRef: (el: HTMLLIElement | null) => void;
  onPlay: () => void;
  onDecide: (vars: DecideVars) => void;
  onDecideAsync: (vars: DecideVars) => Promise<any>;
  onFixCode: (systemCode: string) => void;
  onRename: (name: string) => void;
  onDelete: (reason: string | null) => void;
  onRestore: () => void;
}) {
  // A dry-run simulation was never applied, so it can still be acted on.
  const pending = r.decision_status === "needs_decision" || r.decision_status === "simulated";
  const hasSystem = Boolean(r.system_id);
  const hasCode = Boolean(r.system_code_norm);
  const isDeleted = Boolean(r.deleted_at);
  const label = (key?: string | null) =>
    (key && statuses.find((s) => s.status_key === key)?.label) || key || "—";

  const [choice, setChoice] = useState<string>(r.proposed_status ?? "");
  const [codeDraft, setCodeDraft] = useState<string>(r.system_code_raw ?? "");
  const [nameDraft, setNameDraft] = useState<string>(r.system?.name ?? "");
  // Expanded by default — the queue is worked through, not just scanned.
  const [open, setOpen] = useState(true);
  useEffect(() => { if (highlighted) setOpen(true); }, [highlighted]);

  const mode = (r.automation_mode as string | null) ?? (r.dry_run ? "dry_run" : null);
  const awaitingApproval = mode === "live" && (r as any).manual_approval_required === true;


  const remove = () => {
    const reason = window.prompt("סיבת המחיקה (לא חובה):", "");
    if (reason === null) return; // cancelled
    if (!window.confirm("למחוק את הבקשה? אפשר לשחזר אותה מתצוגת 'נמחקו'.")) return;
    onDelete(reason.trim() || null);
  };

  return (
    <li
      ref={cardRef}
      className={`rounded-xl border bg-card shadow-sm transition-colors ${
        highlighted ? "border-primary ring-2 ring-primary/40" : "border-border"
      } ${isDeleted ? "opacity-70" : ""}`}
    >
      {/* Single-line header. The system name is a real link to its card, so it
          lives outside the toggle button instead of inside it. */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "כווץ בקשה" : "הרחב בקשה"}
          className="flex shrink-0 items-center gap-2 text-sm"
        >
          {open ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            r.request_type === "pticha" ? "bg-emerald-500/15 text-emerald-700"
              : r.request_type === "sgira" ? "bg-rose-500/15 text-rose-700"
              : "bg-amber-500/15 text-amber-700"}`}>
            {r.request_type === "pticha" ? "פתיחה" : r.request_type === "sgira" ? "סגירה" : "לא זוהה"}
          </span>
        </button>
        {r.system ? (
          <Link
            to="/systems/$id"
            params={{ id: r.system.id }}
            className="truncate font-medium text-sm underline decoration-dotted hover:text-primary"
          >
            {r.system.system_code} · {r.system.name}
          </Link>
        ) : (
          <span className="truncate text-sm font-medium">
            {hasCode
              ? `מערכת ${r.system_code_raw ?? r.system_code_norm} — אינה קיימת`
              : "לא זוהה מספר מערכת"}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-hidden
          tabIndex={-1}
          className="flex min-w-0 flex-1 items-center gap-2 text-right text-sm"
        >
          {r.proposed_status && (
            <span className="shrink-0 text-[11px] text-muted-foreground">← {label(r.proposed_status)}</span>
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {DECISION_LABELS[r.decision_status] ?? r.decision_status ?? "בעיבוד"}
          </span>
          {awaitingApproval
            ? <span className="shrink-0 text-[11px] font-medium text-sky-700">פעיל · ממתין לאישור ידני</span>
            : mode && mode !== "live" && <span className="shrink-0 text-[11px] font-medium text-amber-700">בדיקה בלבד</span>}
          {isDeleted && <span className="shrink-0 text-[11px] font-medium text-destructive">נמחקה</span>}
          <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">{fmt(r.received_at)}</span>
        </button>

        {canDelete && (
          isDeleted ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onRestore} aria-label="שחזור הבקשה" title="שחזור">
              <RotateCcw className="size-4" />
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={remove} aria-label="מחיקת הבקשה" title="מחיקה">
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )
        )}
      </div>

      {open && (
      <div className="border-t border-border px-3 pb-3 pt-2">
      <div className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
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


      {/* The transcript that came with this specific mail. Independent of the
          recording: either one may exist without the other. Renders nothing
          when there is no description. */}
      <ReportDescription text={r.report_description} />

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

      {/* A decision that started but did not finish keeps its intent, so the
          screen says what is still missing instead of looking untouched. */}
      {r.manual_action && pending && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          פעולה שהתחילה ולא הושלמה: {ACTION_LABELS[r.manual_action] ?? r.manual_action}
          {r.status_applied_at ? " — הסטטוס כבר עודכן, ממתין להשלמת הפעולות הנלוות" : " — ממתין להשלמה"}
          {". "}לחיצה חוזרת על אותה פעולה תמשיך מהשלב שנעצר.
        </p>
      )}

      {/* Renaming the system straight from the request: the mail often carries
          the real name while the card still holds a temporary one. The same
          field also drives the name-matching flow below for a request whose
          system does not exist yet. */}
      {canDecide && (hasSystem || hasCode) && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            שם המערכת
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="שם המערכת"
              className="w-60 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          {hasSystem ? (
            <>
              <Button size="sm" variant="outline"
                disabled={busy || nameDraft.trim().length < 2 || nameDraft.trim() === (r.system?.name ?? "")}
                onClick={() => onRename(nameDraft.trim())}>
                <Pencil className="size-4" />
                שמור שם
              </Button>
              {r.system?.name_pending && (
                <span className="text-[11px] font-medium text-amber-700">שם זמני — מומלץ לעדכן</span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">ישמש כשם המערכת החדשה. בלי שם — ייווצר שם זמני.</span>
          )}
        </div>
      )}

      {pending && canDecide && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {hasCode ? (
            <>
              {hasSystem && (
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
                  <Button size="sm" disabled={!choice || busy}
                    onClick={() => onDecide({ id: r.id, action: "apply", toStatus: choice })}>
                    <Play className="size-4" />
                    החל סטטוס {choice ? `"${label(choice)}"` : ""}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => onDecide({ id: r.id, action: "keep" })}>
                    השאר ללא שינוי
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => onDecide({ id: r.id, action: "ignore" })}>
                    <SkipForward className="size-4" />
                    התעלם
                  </Button>
                </div>
              )}

              {!hasSystem && (
                <>
                  <SystemMatcher
                    requestId={r.id} name={nameDraft} disabled={busy}
                    statuses={statuses} status={choice} onStatusChange={setChoice}
                    onDecideAsync={onDecideAsync}
                  />
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => onDecide({ id: r.id, action: "ignore" })}>
                    <SkipForward className="size-4" />
                    התעלם
                  </Button>
                </>
              )}
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
      </div>
      )}
    </li>

  );
}
