import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Inbox } from "lucide-react";
import { listRequestsForSystem } from "@/lib/system-requests.functions";
import { decisionStatusLabel, requestTypeLabel } from "@/lib/request-labels";
import { useStatusSettings } from "@/lib/use-status-settings";


const OPEN_DECISIONS = new Set(["needs_decision", "simulated"]);

const LS_KEY = "system_requests_card_expanded_v1";

function readExpanded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

/** A single request's optional free-text report, clamped with a "עוד" toggle. */
function ReportDescription({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full">
      <p className={open ? "" : "line-clamp-2"}>{text}</p>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-primary hover:underline"
      >
        {open ? "פחות" : "עוד"}
      </button>
    </div>
  );
}

/**
 * Recent open/close requests that arrived by email for this system.
 * Rendered only for users holding `requests_view`; the server enforces it too.
 * Collapsed by default (the user's choice is remembered in localStorage) so it
 * never pushes the rest of the system card down.
 */
export function SystemRequestsCard({ systemId, canView }: { systemId: string; canView: boolean }) {
  const fetchFn = useServerFn(listRequestsForSystem);
  const { maps } = useStatusSettings();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(readExpanded()), []);

  /** The status the request set/proposes, shown with the same Hebrew label the
   * rest of the dashboard uses — never the raw English key from the DB. */
  const statusLabel = (key: unknown): string | null => {
    const k = String(key ?? "").trim();
    if (!k) return null;
    return maps.label[k] ?? k;
  };


  const { data = [] } = useQuery({
    queryKey: ["system-requests", "for-system", systemId],
    queryFn: () => fetchFn({ data: { systemId, limit: 10 } }),
    enabled: canView && Boolean(systemId),
    staleTime: 60_000,
  });

  const rows = data as any[];
  if (!canView || rows.length === 0) return null;

  const openCount = rows.filter((r) => OPEN_DECISIONS.has(String(r.decision_status ?? ""))).length;

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(LS_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable — keep in-memory only */
      }
      return next;
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-1.5 text-sm font-semibold"
      >
        <span className="flex items-center gap-1.5">
          <Inbox className="h-4 w-4 text-primary" />
          בקשות אחרונות מהמייל
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">
            {rows.length}
          </span>
          {openCount > 0 && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
              {openCount} פתוחות
            </span>
          )}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                to="/requests"
                search={{ req: r.id }}
                aria-label={`פתיחת פרטי הבקשה מ-${fmt(r.received_at)}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-muted/50 px-2 py-1.5 text-[11px] hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className={`rounded px-1.5 py-0.5 font-semibold ${
                  r.request_type === "pticha" ? "bg-emerald-500/15 text-emerald-700"
                    : r.request_type === "sgira" ? "bg-rose-500/15 text-rose-700"
                    : "bg-amber-500/15 text-amber-700"}`}>
                  {requestTypeLabel(r.request_type)}
                </span>
                <span className="text-muted-foreground">{fmt(r.received_at)}</span>
                <span>{decisionStatusLabel(r.decision_status)}</span>
                {r.new_status && <span className="text-muted-foreground">← {r.new_status}</span>}
                {r.dry_run && <span className="font-medium text-amber-700">בדיקה בלבד</span>}
                {r.report_description && <ReportDescription text={r.report_description} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
