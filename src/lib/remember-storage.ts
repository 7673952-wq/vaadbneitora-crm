// Session persistence for the Supabase browser client.
//
// The session ALWAYS lives in the normal persistent store (localStorage, or the
// preview broker inside the Lovable editor). Nothing clever, nothing async-racy:
// this is the only shape that reliably survives closing the browser on Vercel.
//
// "זכור אותי" is then enforced on top of it by a startup policy:
//   remembered     -> nothing to do, the session is simply there
//   not remembered -> the session is dropped when the browser was CLOSED,
//                     detected with a heartbeat (see enforceRememberPolicy).
// A heartbeat is used instead of sessionStorage alone because sessionStorage is
// per-tab: a user opening a second tab must not be signed out.

import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import { isRemembered } from "@/lib/device-id";

const TAB_KEY = "crm_tab_alive";
const LAST_SEEN_KEY = "crm_last_seen";
const HEARTBEAT_MS = 15_000;
/** Longer than one heartbeat: a gap this big means the browser was closed. */
const CLOSED_GAP_MS = 60_000;

function isAuthKey(key: string): boolean {
  return key.startsWith("sb-") && key.includes("-auth-token");
}

export function rememberAwareStorage() {
  if (typeof window === "undefined") return undefined;
  return brokeredPreviewStorage() ?? window.localStorage;
}

/** Rescues sessions written by the previous sessionStorage-based scheme. */
function adoptLegacySessionStorageTokens() {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k || !isAuthKey(k)) continue;
      const value = sessionStorage.getItem(k);
      if (value != null && localStorage.getItem(k) == null) localStorage.setItem(k, value);
    }
  } catch { /* storage may be blocked; never break boot */ }
}

function clearStoredSession() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isAuthKey(k)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && isAuthKey(k)) sessionStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

/**
 * Runs once at app startup, BEFORE the Supabase client reads the session.
 * Returns true when a non-remembered session was discarded.
 */
export function enforceRememberPolicy(): boolean {
  if (typeof window === "undefined") return false;
  adoptLegacySessionStorageTokens();
  let dropped = false;
  try {
    const freshTab = !sessionStorage.getItem(TAB_KEY);
    const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
    const browserWasClosed = freshTab && (!lastSeen || Date.now() - lastSeen > CLOSED_GAP_MS);
    if (browserWasClosed && !isRemembered()) {
      clearStoredSession();
      dropped = true;
    }
    sessionStorage.setItem(TAB_KEY, "1");
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
  } catch { /* ignore */ }
  return dropped;
}

/** Keeps the "browser is still open" timestamp fresh while any tab lives. */
export function startPresenceHeartbeat(): () => void {
  if (typeof window === "undefined") return () => {};
  const beat = () => {
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
  };
  beat();
  const id = window.setInterval(beat, HEARTBEAT_MS);
  window.addEventListener("visibilitychange", beat);
  window.addEventListener("pagehide", beat);
  return () => {
    window.clearInterval(id);
    window.removeEventListener("visibilitychange", beat);
    window.removeEventListener("pagehide", beat);
  };
}
