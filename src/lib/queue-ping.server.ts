/**
 * Shared, side-effect-free ping for the background-queue endpoints.
 *
 * A GET never processes the queue — it only reports that the endpoint exists
 * and, when an `x-cron-token` header is present, whether that token is the
 * one the database job uses. This lets the health check verify real
 * authentication instead of mere HTTP reachability, without triggering work.
 */
export type QueueName = "voice" | "mention";

export async function queuePingResponse(request: Request, queue: QueueName): Promise<Response> {
  const token = request.headers.get("x-cron-token") ?? "";
  let tokenValid: boolean | null = null;
  if (token) {
    tokenValid = false;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } =
        queue === "voice"
          ? await (supabaseAdmin as any).rpc("voice_cron_token_valid", { _token: token })
          : await (supabaseAdmin as any).rpc("cron_token_valid", { _name: "mention_queue", _token: token });
      tokenValid = !error && data === true;
    } catch {
      tokenValid = false;
    }
  }
  return new Response(JSON.stringify({ ok: true, queue, tokenValid }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
