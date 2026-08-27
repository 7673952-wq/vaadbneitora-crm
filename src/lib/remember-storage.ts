// Remember-aware auth storage for the Supabase browser client.
// "זכור אותי" decides WHERE the session is persisted, chosen at login time:
//   remembered     -> the persistent store (survives a full browser restart)
//   not remembered -> sessionStorage (dies with the browser session)
// The adapter also caches auth-key reads in memory (short TTL) so repeated
// getSession() calls never pay the preview-broker roundtrip more than once
// per TTL window (the broker can take up to 2s per read in a framed preview).

import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import { isRemembered } from "@/lib/device-id";

const STORAGE_V2_KEY = "crm_auth_storage_v2";
const READ_CACHE_TTL_MS = 5_000;

function isAuthKey(key: string): boolean {
  return key.startsWith("sb-") && key.includes("-auth-token");
}

type StorageLike = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export function rememberAwareStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  const persistent = (brokeredPreviewStorage() ?? window.localStorage) as StorageLike;
  const session = window.sessionStorage;

  const readCache = new Map<string, { value: string | null; at: number }>();

  const persistentGet = async (key: string): Promise<string | null> => {
    const cached = readCache.get(key);
    if (cached && Date.now() - cached.at < READ_CACHE_TTL_MS) return cached.value;
    const value = (await persistent.getItem(key)) ?? null;
    readCache.set(key, { value, at: Date.now() });
    return value;
  };
  const persistentSet = async (key: string, value: string) => {
    readCache.set(key, { value, at: Date.now() });
    await persistent.setItem(key, value);
  };
  const persistentRemove = async (key: string) => {
    readCache.set(key, { value: null, at: Date.now() });
    await persistent.removeItem(key);
  };

  return {
    getItem: async (key: string): Promise<string | null> => {
      if (!isAuthKey(key)) return persistentGet(key);
      if (isRemembered()) return persistentGet(key);
      const fromSession = session.getItem(key);
      if (fromSession != null) return fromSession;
      // One-time migration of pre-v2 sessions: they live in the persistent
      // store with no remember flag. Adopt them into session storage so they
      // keep working now but stop surviving a browser restart.
      if (!localStorage.getItem(STORAGE_V2_KEY)) {
        const legacy = await persistentGet(key);
        if (legacy != null) {
          session.setItem(key, legacy);
          await persistentRemove(key);
          return legacy;
        }
      }
      return null;
    },
    setItem: async (key: string, value: string) => {
      if (!isAuthKey(key)) return persistentSet(key, value);
      localStorage.setItem(STORAGE_V2_KEY, "1");
      if (isRemembered()) {
        session.removeItem(key);
        await persistentSet(key, value);
      } else {
        session.setItem(key, value);
        // Never leave a surviving copy in the persistent store.
        await persistentRemove(key);
      }
    },
    removeItem: async (key: string) => {
      if (isAuthKey(key)) session.removeItem(key);
      await persistentRemove(key);
    },
  };
}
