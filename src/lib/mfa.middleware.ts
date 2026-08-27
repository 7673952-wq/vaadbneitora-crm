// Server-side second-factor enforcement, layered on top of bearer auth.
// If the user has MFA enabled, the current JWT session must appear in
// mfa_passed_sessions (written by confirmMfaSession only in exchange for a
// valid one-time mfa_grant). The check is one RPC roundtrip and runs as the
// signed-in user — the MFA tables themselves have no browser grants at all.

import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const MFA_REQUIRED_ERROR = "נדרש אימות נוסף — התחבר מחדש";
export const MFA_CHECK_FAILED_ERROR = "בדיקת אבטחה נכשלה — נסה שוב";

type RpcClient = {
  rpc: (
    name: "mfa_session_ok",
    args: { _user_id: string; _session_id: string },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Throws unless this exact JWT session completed the second factor.
 * Extracted from the middleware so the rule itself is unit-testable:
 * a session that only proved a password must never pass.
 */
export async function assertMfaSession(
  supabase: RpcClient,
  userId: string,
  sessionId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("mfa_session_ok", {
    _user_id: userId,
    _session_id: sessionId,
  });
  if (error) {
    console.error("[mfa] mfa_session_ok failed", error.message);
    throw new Error(MFA_CHECK_FAILED_ERROR);
  }
  // Fail closed: anything other than an explicit `true` is a rejection.
  if (data !== true) throw new Error(MFA_REQUIRED_ERROR);
}

// A dashboard load fires several protected server functions at once; without
// this the second factor costs one extra DB roundtrip each time. Only
// successes are cached, for a short window, so a revoked session (logout)
// loses access within seconds.
const OK_TTL_MS = 30_000;
const okCache = new Map<string, number>();
const inFlightChecks = new Map<string, Promise<void>>();

async function assertMfaSessionOnce(
  supabase: RpcClient,
  userId: string,
  sessionId: string,
  cacheKey: string,
): Promise<void> {
  const existing = inFlightChecks.get(cacheKey);
  if (existing) return existing;
  const check = assertMfaSession(supabase, userId, sessionId)
    .then(() => {
      if (okCache.size > 500) okCache.clear();
      okCache.set(cacheKey, Date.now());
    })
    .finally(() => inFlightChecks.delete(cacheKey));
  inFlightChecks.set(cacheKey, check);
  return check;
}

export const requireAuthMfa = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const claims = context.claims as Record<string, unknown> | undefined;
    const sessionId = typeof claims?.["session_id"] === "string" ? (claims["session_id"] as string) : "";
    const cacheKey = `${context.userId}:${sessionId}`;
    const cachedAt = sessionId ? okCache.get(cacheKey) : undefined;
    if (cachedAt !== undefined && Date.now() - cachedAt < OK_TTL_MS) return next();
    await assertMfaSessionOnce(context.supabase as unknown as RpcClient, context.userId, sessionId, cacheKey);
    return next();
  });
