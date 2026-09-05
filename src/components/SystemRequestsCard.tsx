import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Inbox } from "lucide-react";
import { listRequestsForSystem } from "@/lib/system-requests.functions";

const DECISION_LABELS: Record<string, string> = {
  needs_decision: "דורש החלטה",
  auto_applied: "עודכן אוטומטית",
  manual_applied: "עודכן ידנית",
  kept: "הושאר ללא שינוי",
  ignored: "התעלמות",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Recent open/close requests that arrived by email for this system.
 * Rendered only for users holding `requests_view`; the server enforces it too.
 */
export function SystemRequestsCard({ systemId, canView }: { systemId: string; canView: boolean }) {
  const fetchFn = useServerFn(listRequestsForSystem);
  const { data = [] } = useQuery({
    queryKey: ["system-requests", "for-system", systemId],
    queryFn: () => fetchFn({ data: { systemId, limit: 10 } }),
    enabled: canView && Boolean(systemId),
    staleTime: 60_000,
  });

  if (!canView || (data as any[]).length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Inbox className="h-4 w-4 text-primary" />
        בקשות אחרונות מהמייל
      </h2>
      <ul className="space-y-1.5">
        {(data as any[]).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-muted/50 px-2 py-1.5 text-[11px]">
            <span className={`rounded px-1.5 py-0.5 font-semibold ${
              r.request_type === "pticha" ? "bg-emerald-500/15 text-emerald-700"
                : r.request_type === "sgira" ? "bg-rose-500/15 text-rose-700"
                : "bg-amber-500/15 text-amber-700"}`}>
              {r.request_type === "pticha" ? "פתיחה"
                : r.request_type === "sgira" ? "סגירה"
                : "סוג בקשה לא זוהה"}
            </span>
            <span className="text-muted-foreground">{fmt(r.received_at)}</span>
            <span>{DECISION_LABELS[r.decision_status] ?? r.decision_status ?? "בעיבוד"}</span>
            {r.new_status && <span className="text-muted-foreground">← {r.new_status}</span>}
            {r.dry_run && <span className="font-medium text-amber-700">בדיקה בלבד</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
