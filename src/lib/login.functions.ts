// Login hardening: throttling, the Yemot one-time-code step, session-bound MFA
// proof, and the login journal. The pre-auth functions are intentionally
// public (they run BEFORE a session exists), so every one of them validates
// input and rate-limits.
//
// MFA model (session-bound, no trusted-device bypass):
//   beginLogin      -> password ok + MFA on  => pending challenge + phone call
//   verifyLoginOtp  -> code ok               => one-time short-lived mfa_grant
//   (browser signs in with the password, obtaining a JWT session)
//   confirmMfaSession -> valid grant         => session_id in mfa_passed_sessions
//   requireAuthMfa middleware rejects any protected call whose session has no
//   mfa_passed_sessions row. Logout (endSession) deletes the row, so the next
//   password login always needs a fresh code.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAuthMfa } from "@/lib/mfa.middleware";

const emailSchema = z.string().email().max(200);
const deviceSchema = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);

const GENERIC_LOGIN_ERROR = "פרטי ההתחברות שגויים";
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const MAX_RESENDS = 5;
const GRANT_TTL_MS = 2 * 60_000;
const PASSED_SESSION_TTL_MS = 30 * 24 * 3600_000;

export const beginLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string; device_id: string }) =>
    z.object({
      email: emailSchema,
      password: z.string().min(1).max(200),
      device_id: deviceSchema,
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { throttleLogin, noteLoginFailure, clearLoginFailures } = await import("@/lib/login.server");
    const email = data.email.trim().toLowerCase();

    await throttleLogin(supabaseAdmin, email);

    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } },
    );
    const { data: signIn, error } = await anon.auth.signInWithPassword({
      email, password: data.password,
    });
    if (error || !signIn.user) {
      await noteLoginFailure(supabaseAdmin, email);
      await supabaseAdmin.from("login_events").insert({
        email, kind: "password_failed", device_id: data.device_id,
      });
      throw new Error(GENERIC_LOGIN_ERROR);
    }
    // We never hand this session to the client; the browser signs in itself
    // once the second factor has passed.
    await anon.auth.signOut();
    await clearLoginFailures(supabaseAdmin, email);

    const userId = signIn.user.id;
    const { data: sec, error: secErr } = await supabaseAdmin
      .from("user_security").select("mfa_enabled, mfa_phone").eq("user_id", userId).maybeSingle();
    // A failed lookup must never be read as "second factor disabled".
    if (secErr) {
      console.error("[login] user_security lookup failed", secErr.message);
      throw new Error("בדיקת אבטחה נכשלה — נסה שוב בעוד רגע");
    }

    if (!(sec as any)?.mfa_enabled) return { mfa: false as const };

    const phone = (sec as any)?.mfa_phone as string | null;
    if (!phone) throw new Error("לא הוגדר מספר טלפון לאימות הנוסף — פנה למנהל המערכת");

    const challenge = await issueOtpChallenge(supabaseAdmin, userId, phone, 0);
    return { mfa: true as const, challenge_id: challenge.id as string };
  });

/**
 * Creates a fresh challenge in `pending`, sends the code by phone, then moves
 * it to `active` (or `failed` if the send threw). Older live challenges for
 * the user are revoked only AFTER the new code is known to be on its way, so
 * a failed send never leaves the user without a valid code.
 */
async function issueOtpChallenge(
  supabaseAdmin: any,
  userId: string,
  phone: string,
  resendCount: number,
): Promise<{ id: string }> {
  const { generateOtpCode, hashOtpCode, sendOtpByPhone } = await import("@/lib/otp.server");
  const code = generateOtpCode();
  const { data: challenge, error: chErr } = await supabaseAdmin
    .from("login_otp_challenges")
    .insert({
      user_id: userId,
      code_hash: "",
      state: "pending",
      resend_count: resendCount,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    })
    .select("id").single();
  if (chErr || !challenge) throw new Error("יצירת קוד האימות נכשלה");
  const id = (challenge as any).id as string;
  try {
    await sendOtpByPhone(phone, code);
  } catch (e: any) {
    await supabaseAdmin.from("login_otp_challenges").update({ state: "failed" }).eq("id", id);
    console.error("[login] OTP send failed", e?.message ?? e);
    throw e;
  }
  // Commit the hash only after the code is actually on its way.
  await supabaseAdmin.from("login_otp_challenges")
    .update({ code_hash: hashOtpCode(code, id), state: "active" })
    .eq("id", id);
  await supabaseAdmin.from("login_otp_challenges")
    .update({ state: "revoked" })
    .eq("user_id", userId)
    .in("state", ["pending", "active"])
    .is("consumed_at", null)
    .neq("id", id);
  return { id };
}

/**
 * Sends a fresh code: the OLD challenge stays active until the new one is
 * sent successfully (state machine pending -> active, old -> revoked; on
 * failure new -> failed, old untouched).
 */
export const resendLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { challenge_id: string }) =>
    z.object({ challenge_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("login_otp_challenges")
      .select("id, user_id, expires_at, resend_count, consumed_at, state")
      .eq("id", data.challenge_id).maybeSingle();
    const ch = row as any;
    if (!ch || ch.consumed_at || ch.state !== "active") throw new Error("הקוד אינו תקף — התחבר מחדש");
    if ((ch.resend_count ?? 0) >= MAX_RESENDS) throw new Error("בוצעו יותר מדי שליחות — התחבר מחדש");
    // expires_at is (re)set to now+TTL on every send, so it doubles as the
    // "last sent" marker for the cooldown.
    const lastSent = new Date(ch.expires_at).getTime() - OTP_TTL_MS;
    if (Number.isFinite(lastSent) && Date.now() - lastSent < 30_000) {
      throw new Error("הקוד נשלח זה עתה — נסה שוב בעוד כמה שניות");
    }
    const { data: sec } = await supabaseAdmin
      .from("user_security").select("mfa_phone").eq("user_id", ch.user_id).maybeSingle();
    const phone = (sec as any)?.mfa_phone as string | null;
    if (!phone) throw new Error("לא הוגדר מספר טלפון לאימות הנוסף — פנה למנהל המערכת");

    const fresh = await issueOtpChallenge(supabaseAdmin, ch.user_id, phone, (ch.resend_count ?? 0) + 1);
    return { ok: true as const, challenge_id: fresh.id };
  });

export const verifyLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { challenge_id: string; code: string; device_id: string }) =>
    z.object({
      challenge_id: z.string().uuid(),
      code: z.string().regex(/^\d{8}$/),
      device_id: deviceSchema,
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashOtpCode, generateMfaGrant, hashMfaGrant } = await import("@/lib/otp.server");
    const { data: row } = await supabaseAdmin
      .from("login_otp_challenges")
      .select("id, user_id, code_hash, expires_at, attempts, consumed_at, state")
      .eq("id", data.challenge_id).maybeSingle();
    const ch = row as any;
    if (!ch || ch.consumed_at || ch.state !== "active" || ch.attempts >= OTP_MAX_ATTEMPTS || new Date(ch.expires_at).getTime() < Date.now()) {
      throw new Error("הקוד אינו תקף — בקש קוד חדש");
    }
    if (hashOtpCode(data.code, ch.id) !== ch.code_hash) {
      await supabaseAdmin.from("login_otp_challenges")
        .update({ attempts: ch.attempts + 1 }).eq("id", ch.id);
      throw new Error("קוד שגוי");
    }
    await supabaseAdmin.from("login_otp_challenges")
      .update({ consumed_at: new Date().toISOString(), attempts: ch.attempts + 1 }).eq("id", ch.id);

    // One-time, short-lived grant. The browser exchanges it (after signing in)
    // for a session-bound MFA proof — a password alone is never enough.
    const grant = generateMfaGrant();
    const { error: grantErr } = await supabaseAdmin.from("mfa_grants").insert({
      user_id: ch.user_id,
      grant_hash: hashMfaGrant(grant),
      expires_at: new Date(Date.now() + GRANT_TTL_MS).toISOString(),
    });
    if (grantErr) {
      console.error("[login] mfa_grants insert failed", grantErr.message);
      throw new Error("יצירת אישור האימות נכשלה — נסה שוב");
    }
    return { ok: true as const, mfa_grant: grant };
  });

/**
 * Exchanges a one-time mfa_grant (from verifyLoginOtp) for a session-bound
 * entry in mfa_passed_sessions. The grant must be valid, belong to THIS user,
 * unexpired and unconsumed — and it is consumed by the exchange.
 */
export const confirmMfaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { grant: string }) =>
    z.object({ grant: z.string().min(32).max(128) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashMfaGrant } = await import("@/lib/otp.server");
    const sessionId = (context.claims as any)?.session_id as string | undefined;
    if (!sessionId) throw new Error("אימות Session חסר — התחבר מחדש");

    const { data: row } = await supabaseAdmin
      .from("mfa_grants")
      .select("id, user_id, expires_at, consumed_at")
      .eq("grant_hash", hashMfaGrant(data.grant))
      .maybeSingle();
    const grant = row as any;
    if (!grant || grant.user_id !== context.userId || grant.consumed_at || new Date(grant.expires_at).getTime() < Date.now()) {
      throw new Error("אישור האימות אינו תקף — התחבר מחדש");
    }
    await supabaseAdmin.from("mfa_grants")
      .update({ consumed_at: new Date().toISOString() }).eq("id", grant.id);
    const { error } = await supabaseAdmin.from("mfa_passed_sessions").upsert({
      session_id: sessionId,
      user_id: context.userId,
      expires_at: new Date(Date.now() + PASSED_SESSION_TTL_MS).toISOString(),
    });
    if (error) {
      console.error("[login] mfa_passed_sessions write failed", error.message);
      throw new Error("רישום האימות נכשל — נסה שוב");
    }
    return { ok: true as const };
  });

/**
 * Ends the server-side proof for the current session (and drops any legacy
 * trusted-device record for this device): the next password login requires a
 * fresh code. Called right before the browser signs out.
 */
export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { device_id?: string }) =>
    z.object({ device_id: deviceSchema.optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sessionId = (context.claims as any)?.session_id as string | undefined;
    if (sessionId) {
      await supabaseAdmin.from("mfa_passed_sessions")
        .delete().eq("session_id", sessionId).eq("user_id", context.userId);
    }
    if (data.device_id) {
      await supabaseAdmin.from("mfa_trusted_devices")
        .delete().eq("user_id", context.userId).eq("device_id", data.device_id);
    }
    return { ok: true as const };
  });

/**
 * Authenticated guard used by the app shell (UI optimization only — real
 * enforcement is the requireAuthMfa middleware on every protected ServerFn):
 * reports whether this session still needs to complete the second factor.
 */
export const getSessionSecurity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { device_id?: string }) =>
    z.object({ device_id: deviceSchema.optional() }).parse(d ?? {}),
  )
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sec } = await supabaseAdmin
      .from("user_security").select("mfa_enabled").eq("user_id", context.userId).maybeSingle();
    if (!(sec as any)?.mfa_enabled) return { mfa_required: false as const };
    const sessionId = (context.claims as any)?.session_id as string | undefined;
    if (!sessionId) return { mfa_required: true as const };
    const { data: passed } = await supabaseAdmin
      .from("mfa_passed_sessions").select("session_id")
      .eq("user_id", context.userId).eq("session_id", sessionId)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    return { mfa_required: !passed };
  });

export const recordLoginEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "password" | "session" | "logout"; device_id: string; user_agent?: string }) =>
    z.object({
      kind: z.enum(["password", "session", "logout"]),
      device_id: deviceSchema,
      user_agent: z.string().max(300).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("login_events").insert({
      user_id: context.userId,
      kind: data.kind,
      device_id: data.device_id,
      user_agent: data.user_agent ?? null,
    });
    return { ok: true as const };
  });

export const listLoginEvents = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("login_events")
      .select("id, user_id, email, kind, user_agent, device_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean)));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles").select("id, display_name").in("id", ids as string[]);
      (profs ?? []).forEach((p: any) => names.set(p.id, p.display_name));
    }
    return (rows ?? []).map((r: any) => ({
      ...r,
      display_name: r.user_id ? names.get(r.user_id) ?? null : null,
    }));
  });

// ===== Admin: per-user second factor =====

export const listUserSecurity = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("user_security").select("user_id, mfa_enabled, mfa_phone");
    return (data ?? []) as { user_id: string; mfa_enabled: boolean; mfa_phone: string | null }[];
  });

export const setUserSecurity = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { user_id: string; mfa_enabled: boolean; mfa_phone?: string | null }) =>
    z.object({
      user_id: z.string().uuid(),
      mfa_enabled: z.boolean(),
      mfa_phone: z.string().max(30).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizePhone } = await import("@/lib/otp.server");
    const phone = data.mfa_phone ? normalizePhone(data.mfa_phone) : null;
    if (data.mfa_enabled && !phone) throw new Error("נדרש מספר טלפון לאימות הנוסף");
    const { error } = await supabaseAdmin.from("user_security").upsert({
      user_id: data.user_id,
      mfa_enabled: data.mfa_enabled,
      mfa_phone: phone,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    // Flipping the switch invalidates every outstanding session proof and
    // trusted-device record for that user, so nothing stale keeps working.
    await supabaseAdmin.from("mfa_passed_sessions").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("mfa_trusted_devices").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("login_events").insert({
      user_id: data.user_id,
      kind: data.mfa_enabled ? "mfa_enabled_by_admin" : "mfa_disabled_by_admin",
    });
    return { ok: true as const };
  });
