// One rate limiter for sensitive authenticated actions.
//
// It reuses the SINGLE existing database mechanism (`api_rate_limits` +
// `bump_rate_limit`), so there is no third counter in the project. Unlike the
// public-endpoint limiter, this one FAILS CLOSED: if the counter itself is
// unavailable, a sensitive action does not proceed.

import { AppError } from "@/lib/errors";

export type SensitiveScope =
  | "admin_user_manage"
  | "admin_permissions"
  | "email_send"
  | "request_decide"
  | "request_manage"
  | "system_delete"
  | "import_export"
  | "voice_send"
  | "backup_manage"
  | "backup_restore";

/**
 * Limits chosen from real usage: a person clicking through the UI stays far
 * below them, while a script or a stuck retry loop is stopped quickly.
 * All windows are one minute unless stated otherwise.
 */
export const SENSITIVE_LIMITS: Record<SensitiveScope, { limit: number; windowSeconds: number }> = {
  // Account changes are rare and deliberate.
  admin_user_manage: { limit: 20, windowSeconds: 60 },
  admin_permissions: { limit: 40, windowSeconds: 60 },
  // A person answering mail sends a handful per minute; bulk goes through jobs.
  email_send: { limit: 30, windowSeconds: 60 },
  // Working through the requests queue is fast clicking, so this is generous.
  request_decide: { limit: 60, windowSeconds: 60 },
  request_manage: { limit: 30, windowSeconds: 60 },
  system_delete: { limit: 20, windowSeconds: 60 },
  import_export: { limit: 5, windowSeconds: 300 },
  // Every send costs money at the provider.
  voice_send: { limit: 20, windowSeconds: 60 },
  backup_manage: { limit: 5, windowSeconds: 300 },
  backup_restore: { limit: 2, windowSeconds: 3600 },
};

export async function enforceDbRateLimit(
  supabaseAdmin: any,
  opts: { scope: SensitiveScope; identity: string; limit?: number; windowSeconds?: number },
): Promise<void> {
  const preset = SENSITIVE_LIMITS[opts.scope];
  const limit = opts.limit ?? preset.limit;
  const windowSeconds = opts.windowSeconds ?? preset.windowSeconds;

  const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
    _key: `${opts.scope}:${opts.identity}`,
    _window_seconds: windowSeconds,
  });
  // Supabase returns an error object instead of throwing; both mean the
  // counter did not run, and a sensitive action must not continue blindly.
  if (error) throw new AppError("בדיקת קצב הפעולות אינה זמינה כרגע — נסה שוב בעוד רגע", { code: "internal" });
  const hits = Number(data ?? 0);
  if (!Number.isFinite(hits) || hits <= 0) {
    throw new AppError("בדיקת קצב הפעולות אינה זמינה כרגע — נסה שוב בעוד רגע", { code: "internal" });
  }
  if (hits > limit) {
    throw new AppError("בוצעו יותר מדי פעולות בזמן קצר — נסה שוב בעוד רגע", { code: "rate_limited" });
  }
}
