// Cross-instance rate limiting for /api/public/* endpoints.
//
// The in-memory limiter in rate-limit.server.ts is per-worker, so on a
// multi-instance deployment it under-counts. Public endpoints (webhooks,
// report exports) are reachable by anyone holding a token, so they get a
// DB-backed counter instead: public.bump_rate_limit(key, window_seconds)
// increments and returns the hit count for the current window.
//
// Fails OPEN on database errors — a transient DB hiccup must not block a
// scheduled backup — but every failure is logged.

function clientKey(request: Request): string {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return ip;
}

export async function enforcePublicRateLimit(
  request: Request,
  name: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = `${name}:${clientKey(request)}`;
    const { data, error } = await (supabaseAdmin as any).rpc("bump_rate_limit", {
      _key: key,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.warn("[rate-limit] counter unavailable", error.message);
      return null;
    }
    const hits = Number(data ?? 0);
    if (hits > limit) {
      return new Response(JSON.stringify({ error: "Too Many Requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(windowSeconds) },
      });
    }
    return null;
  } catch (e: any) {
    console.warn("[rate-limit] failed", e?.message ?? e);
    return null;
  }
}
