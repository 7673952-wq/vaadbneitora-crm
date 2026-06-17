// Unified application error. Use AppError for any thrown error so callers can
// distinguish expected/operational failures from unexpected runtime errors.
// Safe to import from both server and client code.

export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "bad_request"
  | "rate_limited"
  | "upstream"
  | "internal";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 400,
  bad_request: 400,
  rate_limited: 429,
  upstream: 502,
  internal: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly cause?: unknown;
  readonly meta?: Record<string, unknown>;

  constructor(
    message: string,
    opts: { code?: AppErrorCode; cause?: unknown; meta?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = opts.code ?? "internal";
    this.status = STATUS_BY_CODE[this.code];
    this.cause = opts.cause;
    this.meta = opts.meta;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (typeof err === "object" && err !== null && (err as any).name === "AppError");
}

// Convenience wrapper around Supabase-shaped errors.
export function fromSupabase(
  err: { message?: string; code?: string; details?: string } | null | undefined,
  fallbackMessage = "שגיאת מסד נתונים",
  code: AppErrorCode = "internal",
): AppError {
  return new AppError(err?.message || fallbackMessage, { code, cause: err, meta: err?.code ? { db_code: err.code } : undefined });
}

// Server-only helper: log unexpected errors and re-throw as AppError.
// Uses dynamic import so this file stays client-safe.
export async function logAndThrow(err: unknown, context: Record<string, unknown> = {}): Promise<never> {
  const appErr = isAppError(err)
    ? err
    : new AppError(err instanceof Error ? err.message : String(err), { cause: err });
  try {
    const { logger } = await import("@/lib/logger.server");
    logger.error(appErr.message, { code: appErr.code, stack: appErr.stack, ...context });
  } catch {
    // best-effort logging
  }
  throw appErr;
}
