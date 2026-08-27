import { useEffect, useState } from "react";
import { readPerfTimings, type PerfTiming } from "@/lib/perf";

/**
 * Small timings panel. Visible only in dev, with ?perf=1, or to admins
 * (the caller passes `enabled`). Shows both the time since the page started
 * and the delta from the previous mark, so a stage that eats seconds is
 * obvious at a glance.
 */
export function PerfOverlay({ enabled }: { enabled?: boolean }) {
  const [rows, setRows] = useState<PerfTiming[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const show =
    hydrated && (enabled ||
      (import.meta.env.DEV || new URLSearchParams(window.location.search).get("perf") === "1"));

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => setRows(readPerfTimings()), 1000);
    return () => clearInterval(id);
  }, [show]);

  if (!show) return null;
  return (
    <div className="fixed bottom-3 left-3 z-[100] text-[11px] font-mono">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-card/90 px-2 py-1 shadow-sm text-muted-foreground"
      >
        ⏱ ביצועים
      </button>
      {open && (
        <div className="mt-1 rounded-md border border-border bg-card/95 p-2 shadow-lg min-w-[280px] max-h-[60vh] overflow-auto">
          <div className="flex justify-between gap-3 text-muted-foreground border-b border-border pb-1 mb-1">
            <span>שלב</span>
            <span>Δ / סה״כ</span>
          </div>
          {rows.length === 0 ? (
            <div className="text-muted-foreground">אין נתונים עדיין</div>
          ) : (
            rows.map((r) => (
              <div key={r.name} className="flex justify-between gap-3">
                <span className="text-muted-foreground truncate" dir="ltr">{r.name}</span>
                <span dir="ltr" className={r.delta != null && r.delta > 1000 ? "text-destructive font-bold" : ""}>
                  {r.delta != null ? `+${r.delta}` : "–"} / {r.ms} ms
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
