// Server-side second-factor enforcement, layered on top of bearer auth.
// If the user has MFA enabled, the current JWT session must appear in
// mfa_passed_sessions (written by confirmMfaSession only in exchange for a
// valid one-time mfa_grant). The check is one RPC roundtrip and runs as the
// signed-in user — the MFA tables themselves have no browser grants at all.

import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const MFA_REQUIRED_ERROR = "נדרש אימות נוסף — התחבר מחדש";

export const requireAuthMfa = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const claims = context.claims as Record<string, unknown> | undefined;
    const sessionId = typeof claims?.["session_id"] === "string" ? (claims["session_id"] as string) : "";
    const { data, error } = await context.supabase.rpc("mfa_session_ok", {
      _user_id: context.userId,
      _session_id: sessionId,
    });
    if (error) {
      console.error("[mfa] mfa_session_ok failed", error.message);
      throw new Error("בדיקת אבטחה נכשלה — נסה שוב");
    }
    if (data !== true) throw new Error(MFA_REQUIRED_ERROR);
    return next();
  });
