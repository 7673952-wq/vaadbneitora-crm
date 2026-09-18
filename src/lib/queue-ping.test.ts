import { describe, it, expect, vi } from "vitest";

const rpcCalls: Array<{ fn: string; args: any }> = [];
let tokenOk = true;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return { data: tokenOk, error: null };
    },
  },
}));

const { queuePingResponse } = await import("./queue-ping.server");

function ping(headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/public/hooks/process-voice-queue", { headers });
}

describe("queuePingResponse — the health ping never processes the queue", () => {
  it("without a token it only confirms the endpoint exists", async () => {
    rpcCalls.length = 0;
    const res = await queuePingResponse(ping(), "voice");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queue: "voice", tokenValid: null });
    // No token to check, and definitely no queue work.
    expect(rpcCalls).toEqual([]);
  });

  it("a valid token is confirmed against the voice validator", async () => {
    rpcCalls.length = 0;
    tokenOk = true;
    const res = await queuePingResponse(ping({ "x-cron-token": "t".repeat(40) }), "voice");
    expect(await res.json()).toMatchObject({ ok: true, queue: "voice", tokenValid: true });
    expect(rpcCalls[0]!.fn).toBe("voice_cron_token_valid");
  });

  it("a wrong token is reported invalid, not as an HTTP failure", async () => {
    tokenOk = false;
    const res = await queuePingResponse(ping({ "x-cron-token": "x".repeat(40) }), "voice");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tokenValid: false });
  });

  it("the mention queue is validated by name", async () => {
    rpcCalls.length = 0;
    tokenOk = true;
    await queuePingResponse(ping({ "x-cron-token": "t".repeat(40) }), "mention");
    expect(rpcCalls[0]).toMatchObject({ fn: "cron_token_valid", args: { _name: "mention_queue" } });
  });
});
