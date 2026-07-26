// Shared auth helper for /api/public/hooks/* webhook endpoints.
// Uses a timing-safe comparison to avoid leaking secret length/content
// via response-time differences.

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyWebhookAuth(request: Request): Response | null {
  const expected = process.env.BACKUP_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const apikey = request.headers.get("apikey") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = timingSafeEqualStr(apikey, expected) || timingSafeEqualStr(bearer, expected);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
