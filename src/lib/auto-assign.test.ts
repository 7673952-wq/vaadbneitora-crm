import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyAutoStatusAssignment } from "./auto-assign.server";
import { AUTO_ASSIGN_REASON, isAutoAssignmentRow, HIDE_AUTO_ASSIGN_FILTER } from "./auto-assign-marker";

vi.mock("@/lib/systems.functions", () => ({
  maybeScheduleOrSendAutoVoice: vi.fn(async () => {}),
}));

function makeClient(rpcResult: any = { data: true, error: null }) {
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  const writes: Array<{ table: string; payload: any }> = [];
  const client: any = {
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
    from: (table: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: null, error: null }),
        update: (payload: any) => {
          writes.push({ table, payload });
          return { ...api, then: (r: any) => Promise.resolve({ data: null, error: null }).then(r) };
        },
        then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
      };
      return api;
    },
  };
  return { client, rpcCalls, writes };
}

describe("applyAutoStatusAssignment", () => {
  it("goes through the atomic RPC so the marker and the UPDATE share one transaction", async () => {
    const { client, rpcCalls, writes } = makeClient();
    const ok = await applyAutoStatusAssignment(client, "sys-1", "agent-1", ["agent-2"]);
    expect(ok).toBe(true);
    expect(rpcCalls).toEqual([
      {
        fn: "apply_auto_status_assignment",
        args: { _system_id: "sys-1", _agent_id: "agent-1", _reminder_agent_ids: ["agent-2"] },
      },
    ]);
    // Never a direct table UPDATE: that would lose the transaction-local marker.
    expect(writes).toEqual([]);
  });

  it("reports failure without throwing", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    expect(await applyAutoStatusAssignment(client, "sys-1", "agent-1", [])).toBe(false);
  });
});

describe("applyStatusSideEffects (request automation path)", () => {
  beforeEach(() => vi.resetModules());

  it("assigns through the same RPC and never merges the agent into a status UPDATE", async () => {
    vi.doMock("@/lib/auto-assign.server", async () => {
      const actual = await vi.importActual<any>("./auto-assign.server");
      return { ...actual, resolveAutoAssign: async () => ({ agentId: "agent-9", otherAgentIds: [] }) };
    });
    const { applyStatusSideEffects } = await import("./system-requests.server");
    const { client, rpcCalls, writes } = makeClient();
    await applyStatusSideEffects(client, "sys-7", "open");
    expect(rpcCalls.map((c) => c.fn)).toContain("apply_auto_status_assignment");
    expect(writes.filter((w) => w.table === "systems")).toEqual([]);
  });
});

describe("hiding automatic assignments", () => {
  it("hides the marked rows of both a root system and its propagated sub-system", () => {
    const rows = [
      { system_id: "root", field: "status", reason: "בקשה במייל" },
      { system_id: "root", field: "assigned_agent_id", reason: AUTO_ASSIGN_REASON },
      // Written by the propagation trigger inside the same transaction.
      { system_id: "child", field: "assigned_agent_id", reason: AUTO_ASSIGN_REASON },
      { system_id: "root", field: "assigned_agent_id", reason: null },
    ];
    const visible = rows.filter((r) => !isAutoAssignmentRow(r));
    expect(visible).toHaveLength(2);
    expect(visible[0].field).toBe("status");
    // The manual transfer (no reason) stays visible.
    expect(visible[1].reason).toBeNull();
    expect(visible.some((r) => r.system_id === "child")).toBe(false);
  });

  it("keeps rows without a reason in the PostgREST filter", () => {
    expect(HIDE_AUTO_ASSIGN_FILTER).toBe(`reason.is.null,reason.neq.${AUTO_ASSIGN_REASON}`);
  });
});
