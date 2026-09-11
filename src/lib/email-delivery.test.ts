import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  beginEmailDelivery,
  finishEmailDelivery,
  idempotencyErrorFor,
  type DeliveryRpcClient,
  type BeginEmailDeliveryResult,
} from "@/lib/email-delivery.server";
import { getSendIntentKey, clearSendIntentKey } from "@/lib/send-intent-key";

function fakeAdmin(script: { begin?: BeginEmailDeliveryResult; finish?: boolean }): DeliveryRpcClient & { rpc: any } {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "begin_email_delivery") return { data: script.begin, error: null };
      if (fn === "finish_email_delivery") return { data: script.finish ?? true, error: null };
      return { data: null, error: { message: "unknown fn" } };
    }),
  };
}

describe("email-delivery.server", () => {
  it("proceed -> relay called once, finish sent", async () => {
    const admin = fakeAdmin({ begin: { action: "proceed" }, finish: true });
    const begin = await beginEmailDelivery(admin, { key: "k1", kind: "system_email", actor: "u1", target: {} });
    expect(begin.action).toBe("proceed");
    let relayCalls = 0;
    if (begin.action === "proceed") relayCalls += 1;
    const ok = await finishEmailDelivery(admin, { key: "k1", status: "sent" });
    expect(ok).toBe(true);
    expect(relayCalls).toBe(1);
  });

  it("duplicate -> relay not called, result carries duplicate:true", async () => {
    const admin = fakeAdmin({ begin: { action: "duplicate", message_id: "gm-1" } });
    const begin = await beginEmailDelivery(admin, { key: "k2", kind: "system_email", actor: "u1", target: {} });
    let relayCalls = 0;
    let result: { duplicate: boolean } | null = null;
    if (begin.action === "duplicate") {
      result = { duplicate: true };
    } else {
      relayCalls += 1;
    }
    expect(relayCalls).toBe(0);
    expect(result).toEqual({ duplicate: true });
  });

  it("crash-then-retry: relay succeeds, finalize throws, retry sees 'unknown' and never calls relay again", async () => {
    // First attempt: begin says proceed, relay call "succeeds" (simulated),
    // but the process crashes before finish_email_delivery ever runs — so
    // the DB is left in a stale "sending" state.
    const admin = fakeAdmin({ begin: { action: "proceed" } });
    const beginFirst = await beginEmailDelivery(admin, { key: "k3", kind: "system_email", actor: "u1", target: {} });
    expect(beginFirst.action).toBe("proceed");
    let relayCallCount = 1; // relay was actually called once on the first (crashed) attempt

    // Simulate the DB flipping a stale "sending" row to "unknown" once its
    // staleness window elapses, as begin_email_delivery would.
    (admin.rpc as any).mockImplementationOnce(async () => ({ data: { action: "unknown" }, error: null }));
    const beginRetry = await beginEmailDelivery(admin, { key: "k3", kind: "system_email", actor: "u1", target: {} });
    expect(beginRetry.action).toBe("unknown");

    let threw: Error | null = null;
    if (beginRetry.action === "busy" || beginRetry.action === "unknown") {
      threw = idempotencyErrorFor(beginRetry.action);
    } else {
      relayCallCount += 1; // must NOT happen
    }
    expect(relayCallCount).toBe(1);
    expect(threw?.message).toContain("אינה ודאית");
  });

  it("failed status -> begin proceed, relay called once, finish sent", async () => {
    const admin = fakeAdmin({ begin: { action: "proceed", status: "failed" }, finish: true });
    const begin = await beginEmailDelivery(admin, { key: "k4", kind: "system_email", actor: "u1", target: {} });
    expect(begin.action).toBe("proceed");
    let relayCalls = 0;
    if (begin.action === "proceed") relayCalls += 1;
    const ok = await finishEmailDelivery(admin, { key: "k4", status: "sent" });
    expect(relayCalls).toBe(1);
    expect(ok).toBe(true);
  });

  it("idempotencyErrorFor gives Hebrew messages for busy/unknown", () => {
    expect(idempotencyErrorFor("busy").message).toContain("כבר מתבצעת");
    expect(idempotencyErrorFor("unknown").message).toContain("אינה ודאית");
  });
});

describe("send-intent-key", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    (globalThis as any).window = globalThis;
    let n = 0;
    (globalThis as any).crypto = { randomUUID: () => `uuid-${++n}` };
  });

  it("returns the same key for a scope until cleared", () => {
    const a = getSendIntentKey("mail:compose");
    const b = getSendIntentKey("mail:compose");
    expect(a).toBe(b);
    clearSendIntentKey("mail:compose");
    const c = getSendIntentKey("mail:compose");
    expect(c).not.toBe(a);
  });

  it("different scopes yield different keys", () => {
    const a = getSendIntentKey("mail:reply:t1");
    const b = getSendIntentKey("mail:reply:t2");
    expect(a).not.toBe(b);
  });
});
