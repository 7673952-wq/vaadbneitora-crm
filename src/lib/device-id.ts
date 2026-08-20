// Stable, non-identifying per-browser id used for login journal entries and
// for remembering that this device already passed the second factor.
// It carries no personal data — just a random string.

const KEY = "crm_device_id";
export const REMEMBER_KEY = "crm_remember_device";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server000";
  let id = localStorage.getItem(KEY);
  if (!id || id.length < 8) {
    id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function isRemembered(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(REMEMBER_KEY) === "1";
}

export function setRemembered(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(REMEMBER_KEY, "1");
  else localStorage.removeItem(REMEMBER_KEY);
}

/** Short, non-sensitive browser description for the login journal. */
export function describeDevice(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent.slice(0, 300);
}
