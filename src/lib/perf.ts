// Lightweight real-user timing. Marks are recorded on the browser's
// Performance timeline, so measurements come from the real render, not from
// a stopwatch guess. The overlay is opt-in (dev, ?perf=1, or admins).

export const PERF_MARKS = [
  "APP_START",
  "AUTH_READY",
  "CONFIG_READY",
  "DASHBOARD_RENDERED",
  "SYSTEMS_READY",
  "DASHBOARD_READY",
  "CHARTS_READY",
] as const;

export type PerfMark = (typeof PERF_MARKS)[number];

export function perfMark(name: PerfMark) {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  // Each mark is recorded once per page load — later duplicates are ignored
  // so a re-render can't skew the numbers.
  if (performance.getEntriesByName(name, "mark").length > 0) return;
  performance.mark(name);
  if (name !== "APP_START" && performance.getEntriesByName("APP_START", "mark").length > 0) {
    try {
      performance.measure(`${name}_since_start`, "APP_START", name);
    } catch {
      /* the start mark may have been cleared — ignore */
    }
  }
}

export function readPerfTimings(): { name: string; ms: number }[] {
  if (typeof performance === "undefined") return [];
  const start = performance.getEntriesByName("APP_START", "mark")[0]?.startTime ?? 0;
  return PERF_MARKS.flatMap((name) => {
    const entry = performance.getEntriesByName(name, "mark")[0];
    return entry ? [{ name, ms: Math.round(entry.startTime - start) }] : [];
  });
}
