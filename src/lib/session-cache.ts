// Module-level access-token cache so the global function middleware does not
// call supabase.auth.getSession() (a storage roundtrip) on every RPC.
// The cache is primed right after sign-in and cleared on sign-out.

import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

let cached: { token: string; expiresAtMs: number } | null = null;
let inFlight: Promise<string | null> | null = null;

const EXPIRY_MARGIN_MS = 60_000;

export async function getAccessToken(): Promise<string | null> {
  if (cached && cached.expiresAtMs - Date.now() > EXPIRY_MARGIN_MS) return cached.token;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      primeAccessToken(data.session ?? null);
      return cached?.token ?? null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function primeAccessToken(session: Session | null) {
  cached = session
    ? { token: session.access_token, expiresAtMs: (session.expires_at ?? 0) * 1000 }
    : null;
}

export function clearAccessToken() {
  cached = null;
}
