// Auth storage is selected at write/read time, not after login:
// remembered sessions live in localStorage; temporary sessions in sessionStorage.
// This is deterministic across a full browser close and does not rely on timing.

import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import { isRemembered, setRemembered } from "@/lib/device-id";

function isAuthKey(key: string): boolean {
  return key.startsWith("sb-") && key.includes("-auth-token");
}

export function rememberAwareStorage() {
  if (typeof window === "undefined") return undefined;
  const previewStorage = brokeredPreviewStorage();
  // Keep the editor's shared-session broker only when it is genuinely active.
  // On Vercel/standalone surfaces brokeredPreviewStorage returns localStorage,
  // where the real persistent-vs-session choice below must apply.
  if (previewStorage && previewStorage !== window.localStorage) return previewStorage;

  return {
    getItem(key: string) {
      return (isRemembered() ? window.localStorage : window.sessionStorage).getItem(key);
    },
    setItem(key: string, value: string) {
      const target = isRemembered() ? window.localStorage : window.sessionStorage;
      const other = isRemembered() ? window.sessionStorage : window.localStorage;
      target.setItem(key, value);
      if (isAuthKey(key)) other.removeItem(key);
    },
    removeItem(key: string) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    },
  };
}

/** Selects persistence before sign-in and migrates any already-written token. */
export function setSessionPersistence(remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    const source = remember ? window.sessionStorage : window.localStorage;
    const target = remember ? window.localStorage : window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < source.length; i++) {
      const key = source.key(i);
      if (key && isAuthKey(key)) keys.push(key);
    }
    setRemembered(remember);
    for (const key of keys) {
      const value = source.getItem(key);
      if (value != null) target.setItem(key, value);
      source.removeItem(key);
    }
  } catch { /* blocked storage must not prevent sign-in */ }
}
