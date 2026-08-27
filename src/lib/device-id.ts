// Stable, non-identifying per-browser id used for login journal entries and
// for remembering that this device already passed the second factor.
// It carries no personal data — just a random string.
//
// Both values are mirrored to first-party cookies: localStorage is wiped by
// storage partitioning (embedded frames) and by "clear data on close" browser
// settings, which used to make the device look brand new on every visit and
// broke "זכור אותי".

import { getDurable, setDurable, deleteDurable } from "@/lib/durable-cookie";

const KEY = "crm_device_id";
export const REMEMBER_KEY = "crm_remember_device";
const YEAR = 60 * 60 * 24 * 365;
const MONTH = 60 * 60 * 24 * 30;

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* blocked storage */ }
}
function lsRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* blocked storage */ }
}

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server000";
  let id = lsGet(KEY) ?? getDurable(KEY);
  if (!id || id.length < 8) {
    id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
  }
  lsSet(KEY, id);
  setDurable(KEY, id, YEAR);
  return id;
}

export function isRemembered(): boolean {
  if (typeof window === "undefined") return false;
  return lsGet(REMEMBER_KEY) === "1" || getDurable(REMEMBER_KEY) === "1";
}

export function setRemembered(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) {
    lsSet(REMEMBER_KEY, "1");
    setDurable(REMEMBER_KEY, "1", MONTH);
  } else {
    lsRemove(REMEMBER_KEY);
    deleteDurable(REMEMBER_KEY);
  }
}

/** Short, non-sensitive browser description for the login journal. */
export function describeDevice(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent.slice(0, 300);
}
