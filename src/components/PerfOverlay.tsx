import { useEffect, useState } from "react";
import { readPerfTimings } from "@/lib/perf";

/**
 * Small timings panel. Visible only in dev, with ?perf=1, or to admins
 * (the caller passes `enabled`).
 */
export function PerfOverlay({ enabled }: { enabled?: boolean }) {
  const [rows, setRows] = useState<{ name: string; ms: number }[]>([]);
  const [open, setOpen] = useState(false);
  const show =
    enabled ||
    (typeof window !== "undefined" &&
      (import.meta.env.DEV || new URLSearchParams(window.location.search).get("perf") === "1"));

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
        <div className="mt-1 rounded-md border border-border bg-card/95 p-2 shadow-lg min-w-[220px]">
          {rows.length === 0 ? (
            <div className="text-muted-foreground">אין נתונים עדיין</div>
          ) : (
            rows.map((r) => (
              <div key={r.name} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{r.name}</span>
                <span>{r.ms} ms</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
