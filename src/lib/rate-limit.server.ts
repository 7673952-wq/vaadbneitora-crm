import { AppError } from "@/lib/errors";

// Simple in-memory rate limiter. Note: server runs on stateless workers,
// so this is best-effort per-instance protection, not a global guarantee.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (b.count >= limit) {
    throw new AppError("יותר מדי בקשות, נסה שוב בעוד רגע", { code: "rate_limited" });
  }
  b.count += 1;
}
