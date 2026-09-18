import { describe, it, expect } from "vitest";
import { releaseSystemRequestClaim, clearManualIntent } from "./system-requests.server";

/**
 * Item 8: releasing the atomic claim and clearing the durable manual-decision
 * intent must never swallow an error, and a boolean "did nothing" result
 * must never be reported as success either.
 */
describe("releaseSystemRequestClaim", () => {
  function fakeAdmin(opts: { error?: string; result?: boolean }) {
    const calls: any[] = [];
    return {
      calls,
      rpc: async (fn: string, args: any) => {
        calls.push({ fn, args });
        if (opts.error) return { data: null, error: { message: opts.error } };
        return { data: opts.result ?? true, error: null };
      },
    };
  }

  it("succeeds and passes the actor through when the RPC reports success", async () => {
    const admin = fakeAdmin({ result: true });
    await expect(releaseSystemRequestClaim(admin as any, "req-1", "actor-1", "boom")).resolves.toBe(true);
    expect(admin.calls[0]).toEqual({
      fn: "release_system_request_claim",
      args: { _id: "req-1", _actor: "actor-1", _error: "boom" },
    });
  });

  it("propagates a technical RPC failure instead of swallowing it", async () => {
    const admin = fakeAdmin({ error: "connection reset" });
    await expect(releaseSystemRequestClaim(admin as any, "req-1", "actor-1")).rejects.toThrow(/שחרור הנעילה על הבקשה נכשל/);
  });

  it("a stale actor's release (RPC returns false because it no longer owns the claim) is NOT reported as success", async () => {
    // The RPC is actor-scoped: it only clears the claim when `_actor` still
    // owns it. A stale/late release call from a timed-out attempt whose
    // claim was already taken over by someone else must come back `false` —
    // and the wrapper must throw, never return true.
    const admin = fakeAdmin({ result: false });
    await expect(releaseSystemRequestClaim(admin as any, "req-1", "stale-actor")).rejects.toThrow(/כבר בטיפול של משתמש אחר/);
  });
});

describe("clearManualIntent", () => {
  function fakeSupabase(opts: { error?: string; matched?: boolean }) {
    return {
      from: (_table: string) => ({
        update: (_patch: any) => ({
          eq: (_col: string, _val: string) => ({
            select: (_cols: string) => {
              if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } });
              return Promise.resolve({ data: opts.matched === false ? [] : [{ id: "req-1" }], error: null });
            },
          }),
        }),
      }),
    };
  }

  it("succeeds when the row was actually cleared", async () => {
    const supabase = fakeSupabase({ matched: true });
    await expect(clearManualIntent(supabase as any, "req-1")).resolves.toBe(true);
  });

  it("propagates a failed UPDATE instead of pretending the intent was cleared", async () => {
    const supabase = fakeSupabase({ error: "connection reset" });
    await expect(clearManualIntent(supabase as any, "req-1")).rejects.toThrow(/ניקוי כוונת ההחלטה נכשל/);
  });

  it("a no-op UPDATE (row not found / already changed) is NOT reported as success", async () => {
    const supabase = fakeSupabase({ matched: false });
    await expect(clearManualIntent(supabase as any, "req-1")).rejects.toThrow(/רענן ונסה שוב/);
  });
});
