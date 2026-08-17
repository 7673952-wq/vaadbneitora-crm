// Shared auth helper for /api/public/hooks/* webhook endpoints.
// Uses a timing-safe comparison to avoid leaking secret length/content
// via response-time differences.

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function auditDenied(request: Request, reason: string) {
  // Best-effort audit of rejected webhook calls, so the audit screen shows
  // failed attempts too. Never blocks or throws.
  void (async () => {
    try {
      const { logDeniedAttempt } = await import("@/lib/permissions.server");
      const path = new URL(request.url).pathname;
      await logDeniedAttempt(null, "webhook_auth", `${reason}: ${path}`);
    } catch { /* ignore */ }
  })();
}

export function verifyWebhookAuth(request: Request): Response | null {
  const expected = process.env.BACKUP_WEBHOOK_SECRET || process.env.CRON_SECRET;
  const unauthorized = () => new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
  if (!expected) {
    auditDenied(request, "missing_secret");
    return unauthorized();
  }
  const apikey = request.headers.get("apikey") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = timingSafeEqualStr(apikey, expected) || timingSafeEqualStr(bearer, expected);
  if (!ok) {
    auditDenied(request, "bad_secret");
    return unauthorized();
  }
  return null;
}
