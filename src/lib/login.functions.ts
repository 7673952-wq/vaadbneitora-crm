// Login hardening: throttling, optional Yemot one-time-code step, and the
// login journal. These functions are intentionally public (they run BEFORE a
// session exists), so every one of them validates input and rate-limits.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const emailSchema = z.string().email().max(200);
const deviceSchema = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);

const GENERIC_LOGIN_ERROR = "פרטי ההתחברות שגויים";
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const TRUSTED_DEVICE_DAYS = 30;

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
    // once the (optional) second factor has passed.
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

    const { data: trusted } = await supabaseAdmin
      .from("mfa_trusted_devices").select("expires_at")
      .eq("user_id", userId).eq("device_id", data.device_id).maybeSingle();
    if (trusted && new Date((trusted as any).expires_at).getTime() > Date.now()) {
      return { mfa: false as const };
    }

    const phone = (sec as any)?.mfa_phone as string | null;
    if (!phone) throw new Error("לא הוגדר מספר טלפון לאימות הנוסף — פנה למנהל המערכת");

    const { generateOtpCode, hashOtpCode, sendOtpByPhone } = await import("@/lib/otp.server");
    const code = generateOtpCode();
    const { data: challenge, error: chErr } = await supabaseAdmin
      .from("login_otp_challenges")
      .insert({
        user_id: userId,
        code_hash: "",
        expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      })
      .select("id").single();
    if (chErr || !challenge) throw new Error("יצירת קוד האימות נכשלה");
    // Salt with the challenge id so the same code in two challenges differs.
    await supabaseAdmin.from("login_otp_challenges")
      .update({ code_hash: hashOtpCode(code, (challenge as any).id) })
      .eq("id", (challenge as any).id);

    await sendOtpByPhone(phone, code);
    return { mfa: true as const, challenge_id: (challenge as any).id as string };
  });

export const verifyLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { challenge_id: string; code: string; device_id: string; remember: boolean }) =>
    z.object({
      challenge_id: z.string().uuid(),
      code: z.string().regex(/^\d{8}$/),
      device_id: deviceSchema,
      remember: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashOtpCode } = await import("@/lib/otp.server");
    const { data: row } = await supabaseAdmin
      .from("login_otp_challenges")
      .select("id, user_id, code_hash, expires_at, attempts, consumed_at")
      .eq("id", data.challenge_id).maybeSingle();
    const ch = row as any;
    if (!ch || ch.consumed_at || ch.attempts >= OTP_MAX_ATTEMPTS || new Date(ch.expires_at).getTime() < Date.now()) {
      throw new Error("הקוד אינו תקף — בקש קוד חדש");
    }
    if (hashOtpCode(data.code, ch.id) !== ch.code_hash) {
      await supabaseAdmin.from("login_otp_challenges")
        .update({ attempts: ch.attempts + 1 }).eq("id", ch.id);
      throw new Error("קוד שגוי");
    }
    await supabaseAdmin.from("login_otp_challenges")
      .update({ consumed_at: new Date().toISOString(), attempts: ch.attempts + 1 }).eq("id", ch.id);

    const ttlDays = data.remember ? TRUSTED_DEVICE_DAYS : 0.5;
    await supabaseAdmin.from("mfa_trusted_devices").upsert({
      user_id: ch.user_id,
      device_id: data.device_id,
      verified_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlDays * 24 * 3600_000).toISOString(),
    });
    return { ok: true as const };
  });

/**
 * Authenticated guard used by the app shell: if the signed-in user has the
 * second factor enabled and this device was never verified (or the trust
 * expired), the shell signs them out. Enforced server-side so a client can't
 * skip `beginLogin`.
 */
export const getSessionSecurity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { device_id: string }) => z.object({ device_id: deviceSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sec } = await supabaseAdmin
      .from("user_security").select("mfa_enabled").eq("user_id", context.userId).maybeSingle();
    if (!(sec as any)?.mfa_enabled) return { mfa_required: false as const };
    const { data: trusted } = await supabaseAdmin
      .from("mfa_trusted_devices").select("expires_at")
      .eq("user_id", context.userId).eq("device_id", data.device_id).maybeSingle();
    const ok = !!trusted && new Date((trusted as any).expires_at).getTime() > Date.now();
    return { mfa_required: !ok };
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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("login_events")
      .select("id, user_id, email, kind, user_agent, created_at")
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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
    await assertPermissionInAnyCrm(context.userId, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("user_security").select("user_id, mfa_enabled, mfa_phone");
    return (data ?? []) as { user_id: string; mfa_enabled: boolean; mfa_phone: string | null }[];
  });

export const setUserSecurity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    // Turning it off clears device trust so nothing stale keeps enforcing it.
    if (!data.mfa_enabled) {
      await supabaseAdmin.from("mfa_trusted_devices").delete().eq("user_id", data.user_id);
    }
    await supabaseAdmin.from("login_events").insert({
      user_id: data.user_id,
      kind: data.mfa_enabled ? "mfa_enabled_by_admin" : "mfa_disabled_by_admin",
    });
    return { ok: true as const };
  });
