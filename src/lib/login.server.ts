// Server-side login throttling. Backed by the existing `api_rate_limits`
// table (via the bump_rate_limit function) so it survives across workers and
// cannot be bypassed from the browser.
//
// Every database call here checks BOTH the returned error and the data:
// Supabase returns an error object instead of throwing, so a try/catch alone
// would silently treat a broken counter as "no failures so far".

const WINDOW_SECONDS = 15 * 60;
const FREE_ATTEMPTS = 5;
const HARD_BLOCK_AT = 15;

function key(email: string) {
  return `login_fail:${email}`;
}

function windowStartIso(windowSeconds: number) {
  return new Date(Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds * 1000).toISOString();
}

/** Reads the current failure count without incrementing it. */
async function currentFailures(supabaseAdmin: any, email: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("api_rate_limits")
    .select("hits")
    .eq("bucket_key", key(email))
    .eq("window_start", windowStartIso(WINDOW_SECONDS))
    .maybeSingle();
  // Fail closed: without a working counter we cannot tell a first attempt
  // from the hundredth one.
  if (error) throw new Error("בדיקת האבטחה אינה זמינה כרגע — נסה שוב בעוד רגע");
  return Number((data as any)?.hits ?? 0);
}

/**
 * Progressive back-off: the first few attempts are free, then each further
 * failed attempt in the window adds delay, and past a hard limit the attempt
 * is refused outright for the rest of the window.
 */
export async function throttleLogin(supabaseAdmin: any, email: string): Promise<void> {
  const fails = await currentFailures(supabaseAdmin, email);
  if (fails >= HARD_BLOCK_AT) {
    throw new Error("החשבון ננעל זמנית עקב ניסיונות רבים. נסה שוב מאוחר יותר");
  }
  if (fails > FREE_ATTEMPTS) {
    const delayMs = Math.min(2 ** (fails - FREE_ATTEMPTS), 8) * 1000;
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export async function noteLoginFailure(supabaseAdmin: any, email: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("bump_rate_limit", {
    _key: key(email),
    _window_seconds: WINDOW_SECONDS,
  });
  if (error) throw new Error("בדיקת האבטחה אינה זמינה כרגע — נסה שוב בעוד רגע");
}

export async function clearLoginFailures(supabaseAdmin: any, email: string): Promise<void> {
  await supabaseAdmin.from("api_rate_limits").delete().eq("bucket_key", key(email));
}

// ---------------------------------------------------------------------------
// OTP send throttle — independent of any single challenge, so restarting the
// login flow (beginLogin) cannot reset it the way `resend_count` could.
const OTP_WINDOW_SECONDS = 15 * 60;
const OTP_MAX_PER_WINDOW = 5;
const OTP_MIN_GAP_MS = 30_000;

function otpKey(userId: string) {
  return `otp_send:${userId}`;
}

/**
 * Throws when this user asked for a code too recently (30s) or too often
 * (5 per 15 minutes). Counts every send — first one and resends alike.
 */
export async function throttleOtpSend(supabaseAdmin: any, userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("api_rate_limits")
    .select("hits, updated_at")
    .eq("bucket_key", otpKey(userId))
    .eq("window_start", windowStartIso(OTP_WINDOW_SECONDS))
    .maybeSingle();
  if (error) throw new Error("בדיקת האבטחה אינה זמינה כרגע — נסה שוב בעוד רגע");
  const hits = Number((data as any)?.hits ?? 0);
  const last = (data as any)?.updated_at ? new Date((data as any).updated_at).getTime() : 0;
  if (hits >= OTP_MAX_PER_WINDOW) {
    throw new Error("נשלחו יותר מדי קודי אימות — נסה שוב בעוד רבע שעה");
  }
  if (last && Date.now() - last < OTP_MIN_GAP_MS) {
    throw new Error("הקוד נשלח זה עתה — נסה שוב בעוד כמה שניות");
  }
}

export async function noteOtpSend(supabaseAdmin: any, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("bump_rate_limit", {
    _key: otpKey(userId),
    _window_seconds: OTP_WINDOW_SECONDS,
  });
  if (error) throw new Error("בדיקת האבטחה אינה זמינה כרגע — נסה שוב בעוד רגע");
}
