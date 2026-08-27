// Auth storage is chosen ONCE per page load, not re-decided on every read:
//   remembered sessions -> localStorage (survive a full browser close)
//   temporary sessions  -> sessionStorage (die with the browser session)
//
// Deciding per call made it possible for the same auth key to exist in BOTH
// stores; the stale copy could then win and its already-rotated refresh token
// would fail the first refresh after reopening the browser — which looks
// exactly like "remember me is broken". The adapter now keeps exactly one copy.

import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import { isRemembered, setRemembered } from "@/lib/device-id";
import { getDurable, setDurable, deleteDurable } from "@/lib/durable-cookie";

// Remembered sessions are ALSO mirrored into a first-party cookie. Some
// browsers/embeddings drop localStorage between launches; the cookie keeps the
// session alive there, and is restored into localStorage on the next load.
const AUTH_COOKIE = "crm_auth_session";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function mirrorToCookie(key: string, value: string) {
  if (!isRemembered()) { deleteDurable(AUTH_COOKIE); return; }
  setDurable(AUTH_COOKIE, JSON.stringify({ k: key, v: value }), AUTH_COOKIE_MAX_AGE);
}

/** Puts a cookie-mirrored session back into localStorage when it was wiped. */
function restoreFromCookie() {
  if (!isRemembered()) return;
  const raw = getDurable(AUTH_COOKIE);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.k !== "string" || typeof parsed?.v !== "string") return;
    if (!isAuthKey(parsed.k)) return;
    if (window.localStorage.getItem(parsed.k)) return; // storage already has it
    window.localStorage.setItem(parsed.k, parsed.v);
  } catch { /* malformed mirror is simply ignored */ }
}

function isAuthKey(key: string): boolean {
  return key.startsWith("sb-") && key.includes("-auth-token");
}

function authKeysIn(store: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && isAuthKey(key)) keys.push(key);
    }
  } catch { /* blocked storage */ }
  return keys;
}

/** Removes every auth copy from the store that must not hold the session. */
function dropAuthKeys(store: Storage) {
  for (const key of authKeysIn(store)) {
    try { store.removeItem(key); } catch { /* ignore */ }
  }
}

function targetStore(): Storage {
  return isRemembered() ? window.localStorage : window.sessionStorage;
}

function otherStore(): Storage {
  return isRemembered() ? window.sessionStorage : window.localStorage;
}

export function rememberAwareStorage() {
  if (typeof window === "undefined") return undefined;
  const previewStorage = brokeredPreviewStorage();
  // Keep the editor's shared-session broker only when it is genuinely active.
  // On Vercel/standalone surfaces brokeredPreviewStorage returns localStorage,
  // where the real persistent-vs-session choice below must apply.
  if (previewStorage && previewStorage !== window.localStorage) return previewStorage;

  // Resolved once per page load, and again only when the login screen changes
  // the choice through setSessionPersistence (which clears both stores first).
  restoreFromCookie();
  dropAuthKeys(otherStore());

  return {
    getItem(key: string) {
      try { return targetStore().getItem(key); } catch { return null; }
    },
    setItem(key: string, value: string) {
      try { targetStore().setItem(key, value); } catch { /* ignore */ }
      if (isAuthKey(key)) {
        try { otherStore().removeItem(key); } catch { /* ignore */ }
        mirrorToCookie(key, value);
      }
    },
    removeItem(key: string) {
      try { window.localStorage.removeItem(key); } catch { /* ignore */ }
      try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
      if (isAuthKey(key)) deleteDurable(AUTH_COOKIE);
    },
  };
}

/**
 * Selects persistence before sign-in. The session itself is NOT copied between
 * stores: any pre-existing token is discarded so only the token written by the
 * upcoming sign-in survives, and no rotated refresh token can compete with it.
 */
export function setSessionPersistence(remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    setRemembered(remember);
    dropAuthKeys(window.localStorage);
    dropAuthKeys(window.sessionStorage);
    deleteDurable(AUTH_COOKIE);
  } catch { /* blocked storage must not prevent sign-in */ }
}

/** Read-only snapshot for the ?authdebug=1 panel. Never exposes token values. */
export function authStorageDiagnostics() {
  if (typeof window === "undefined") return null;
  const describe = (store: Storage) =>
    authKeysIn(store).map((key) => {
      let expiresAt: string | null = null;
      let hasRefresh = false;
      try {
        const parsed = JSON.parse(store.getItem(key) ?? "{}");
        const exp = parsed?.expires_at;
        if (typeof exp === "number") expiresAt = new Date(exp * 1000).toLocaleString("he-IL");
        hasRefresh = typeof parsed?.refresh_token === "string" && parsed.refresh_token.length > 0;
      } catch { /* malformed entry */ }
      return { key, expiresAt, hasRefresh };
    });
  return {
    remembered: isRemembered(),
    cookieMirror: !!getDurable(AUTH_COOKIE),
    local: describe(window.localStorage),
    session: describe(window.sessionStorage),
  };
}
