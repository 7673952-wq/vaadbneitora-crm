import { describe, it, expect, vi } from "vitest";
import { enforceDbRateLimit, SENSITIVE_LIMITS } from "./db-rate-limit.server";

/** Counter stand-in: one shared window per key, like bump_rate_limit. */
function makeClient(opts: { error?: string; nullData?: boolean } = {}) {
  const hits = new Map<string, number>();
  const calls: Array<{ key: string; window: number }> = [];
  return {
    calls,
    rpc: async (_fn: string, args: any) => {
      calls.push({ key: args._key, window: args._window_seconds });
      if (opts.error) return { data: null, error: { message: opts.error } };
      if (opts.nullData) return { data: null, error: null };
      const next = (hits.get(args._key) ?? 0) + 1;
      hits.set(args._key, next);
      return { data: next, error: null };
    },
  } as any;
}

describe("enforceDbRateLimit", () => {
  it("allows every call up to the limit and rejects the one after it", async () => {
    const client = makeClient();
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      await expect(enforceDbRateLimit(client, { scope: "voice_send", identity: "u1", limit })).resolves.toBeUndefined();
    }
    await expect(enforceDbRateLimit(client, { scope: "voice_send", identity: "u1", limit }))
      .rejects.toThrow(/יותר מדי פעולות/);
  });

  it("counts each user separately", async () => {
    const client = makeClient();
    await enforceDbRateLimit(client, { scope: "voice_send", identity: "a", limit: 1 });
    await expect(enforceDbRateLimit(client, { scope: "voice_send", identity: "b", limit: 1 })).resolves.toBeUndefined();
    await expect(enforceDbRateLimit(client, { scope: "voice_send", identity: "a", limit: 1 })).rejects.toThrow();
  });

  it("counts each scope separately", async () => {
    const client = makeClient();
    await enforceDbRateLimit(client, { scope: "voice_send", identity: "a", limit: 1 });
    await expect(enforceDbRateLimit(client, { scope: "email_send", identity: "a", limit: 1 })).resolves.toBeUndefined();
  });

  it("fails CLOSED when the counter returns an error object", async () => {
    const client = makeClient({ error: "connection reset" });
    await expect(enforceDbRateLimit(client, { scope: "backup_restore", identity: "a" }))
      .rejects.toThrow(/אינה זמינה/);
  });

  it("fails CLOSED when the counter returns no count at all", async () => {
    const client = makeClient({ nullData: true });
    await expect(enforceDbRateLimit(client, { scope: "backup_restore", identity: "a" }))
      .rejects.toThrow(/אינה זמינה/);
  });

  it("does not leak database details into the message", async () => {
    const client = makeClient({ error: "relation api_rate_limits does not exist" });
    await expect(enforceDbRateLimit(client, { scope: "admin_user_manage", identity: "a" }))
      .rejects.toThrow(/^(?!.*api_rate_limits).*$/);
  });

  it("uses the preset window for the scope", async () => {
    const client = makeClient();
    await enforceDbRateLimit(client, { scope: "import_export", identity: "a" });
    expect(client.calls[0].window).toBe(SENSITIVE_LIMITS.import_export.windowSeconds);
  });
});
