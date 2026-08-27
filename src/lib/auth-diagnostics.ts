// Small in-memory ring buffer of auth lifecycle events, so a real user on the
// production surface can open ?authdebug=1 and tell us WHY a session vanished
// (storage empty vs. refresh rejected) instead of us guessing.

export type AuthLogEntry = { at: string; event: string; detail?: string };

const MAX = 40;
const entries: AuthLogEntry[] = [];
const listeners = new Set<() => void>();

export function logAuthEvent(event: string, detail?: string) {
  entries.push({ at: new Date().toLocaleTimeString("he-IL"), event, detail });
  if (entries.length > MAX) entries.shift();
  if (typeof console !== "undefined") console.info(`[auth] ${event}`, detail ?? "");
  listeners.forEach((l) => l());
}

export function readAuthLog(): AuthLogEntry[] {
  return entries.slice().reverse();
}

export function subscribeAuthLog(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function authDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("authdebug") === "1") {
      sessionStorage.setItem("crm_authdebug", "1");
    }
    return sessionStorage.getItem("crm_authdebug") === "1";
  } catch { return false; }
}
