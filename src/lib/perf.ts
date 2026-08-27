// Lightweight real-user timing. Marks are recorded on the browser's
// Performance timeline, so measurements come from the real render, not from
// a stopwatch guess. The overlay is opt-in (dev, ?perf=1, or admins).

export const PERF_MARKS = [
  "APP_START",
  "LOGIN_FLOW_START",
  // Login flow (recorded on the SPA, so APP_START may precede them by a lot —
  // read the delta column in the overlay for the login timeline).
  "OTP_SUBMIT_START",
  "OTP_VERIFY_DONE",
  "SUPABASE_SIGNIN_START",
  "SUPABASE_SIGNIN_DONE",
  "SESSION_READY",
  "SESSION_SECURITY_START",
  "SESSION_SECURITY_DONE",
  "AUTH_COMPLETE",
  "NAVIGATE_START",
  // App shell / dashboard.
  "AUTH_READY",
  "DASHBOARD_ROUTE_READY",
  "STATUS_SETTINGS_START",
  "STATUS_SETTINGS_READY",
  "CONFIG_READY",
  "SYSTEMS_QUERY_START",
  "SYSTEMS_QUERY_DONE",
  "DASHBOARD_ABOVE_FOLD_READY",
  "DASHBOARD_RENDERED",
  "SYSTEMS_READY",
  "DASHBOARD_READY",
  "CHARTS_READY",
  "DASHBOARD_FULL_READY",
] as const;

export type PerfMark = (typeof PERF_MARKS)[number];

export function perfMark(name: PerfMark) {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  // Each mark is recorded once per page load — later duplicates are ignored
  // so a re-render can't skew the numbers.
  if (performance.getEntriesByName(name, "mark").length > 0) return;
  performance.mark(name);
}

export type PerfTiming = { name: string; ms: number; delta: number | null };

export function readPerfTimings(reference: PerfMark = "APP_START"): PerfTiming[] {
  if (typeof performance === "undefined") return [];
  const start = performance.getEntriesByName(reference, "mark")[0]?.startTime ?? 0;
  let prev: number | null = null;
  return PERF_MARKS.flatMap((name) => {
    const entry = performance.getEntriesByName(name, "mark")[0];
    if (!entry) return [];
    const ms = Math.round(entry.startTime - start);
    const delta = prev == null ? null : Math.round(entry.startTime - prev);
    prev = entry.startTime;
    return [{ name, ms, delta }];
  });
}

/**
 * Clears the login-flow marks before a fresh attempt so a second measurement
 * works. APP_START is deliberately preserved — it is the page-load reference
 * that readPerfTimings() measures against.
 */
export function resetPerfTimings() {
  if (typeof performance === "undefined" || typeof performance.clearMarks !== "function") return;
  for (const name of PERF_MARKS) {
    if (name === "APP_START") continue;
    performance.clearMarks(name);
  }
}
