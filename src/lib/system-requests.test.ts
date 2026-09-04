import { describe, it, expect, vi } from "vitest";
import { normalizeSourceRequestType, ingestSystemRequest } from "./system-requests.server";

vi.mock("@/lib/systems.functions", () => ({
  maybeScheduleOrSendAutoVoice: vi.fn(async () => {}),
}));
vi.mock("@/lib/auto-assign.server", () => ({
  resolveAutoAssign: vi.fn(async () => null),
  applyAutoStatusAssignment: vi.fn(async () => true),
}));

/**
 * Minimal chainable stand-in for the Supabase admin client. It records every
 * write so a test can assert that dry-run mode performs none of them.
 */
function makeClient(opts: {
  settings?: Record<string, unknown>;
  systems?: any[];
  rules?: any[];
  existingRequest?: any;
  /** Force a technical failure from a specific RPC. */
  rpcErrors?: Record<string, string>;
  /** Force a business "false" answer from a specific RPC. */
  rpcResults?: Record<string, unknown>;
  /** Force a failed UPDATE on system_requests. */
  updateError?: string;
  /** Force a failed READ, keyed by app_settings key or by table name. */
  readErrors?: Record<string, string>;
}) {
  const writes: Array<{ table: string; op: string; payload: any }> = [];
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  let request: any = opts.existingRequest ?? null;

  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => { filters[col] = val; return api; },
      order: () => api,
      insert: (payload: any) => {
        writes.push({ table, op: "insert", payload });
        // Mirrors the unique index on gmail_message_id: an existing row wins.
        if (table === "system_requests" && !request) {
          request = { id: "req-1", processing_state: "received", ...payload };
        }
        if (table === "systems") {
          const created = { id: "sys-new", status: payload.status };
          (opts.systems ??= []).push(created);
          const result = { data: created, error: null };
          return { ...api, maybeSingle: async () => result, then: (r: any) => Promise.resolve(result).then(r) };
        }
        const result = { data: null, error: null };
        return { ...api, then: (r: any) => Promise.resolve(result).then(r) };
      },
      update: (payload: any) => {
        writes.push({ table, op: "update", payload });
        const error = table === "system_requests" && opts.updateError ? { message: opts.updateError } : null;
        if (!error && table === "system_requests" && request) request = { ...request, ...payload };
        // The result must survive the trailing .eq() of update().eq("id", …).
        const chain: any = {
          eq: () => chain,
          select: () => chain,
          maybeSingle: async () => ({ data: null, error }),
          then: (r: any) => Promise.resolve({ data: null, error }).then(r),
        };
        return chain;
      },

      maybeSingle: async () => {
        if (table === "app_settings") {
          const key = filters["key"] as string;
          return { data: opts.settings?.[key] ? { value: opts.settings[key] } : null, error: null };
        }
        if (table === "system_requests") return { data: request, error: null };
        if (table === "systems") {
          return { data: (opts.systems ?? []).find((s) => s.id === filters["id"]) ?? null, error: null };
        }
        return { data: null, error: null };
      },
      then: (r: any) => {
        if (table === "system_request_rules") return Promise.resolve({ data: opts.rules ?? [], error: null }).then(r);
        return Promise.resolve({ data: [], error: null }).then(r);
      },
    };
    return api;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (opts.rpcErrors?.[fn]) return { data: null, error: { message: opts.rpcErrors[fn] } };
      if (fn in (opts.rpcResults ?? {})) return { data: opts.rpcResults![fn], error: null };
      if (fn === "bump_rate_limit") return { data: 1, error: null };
      if (fn === "find_systems_by_code_key") return { data: opts.systems ?? [], error: null };
      if (fn === "apply_request_status_change") return { data: true, error: null };
      return { data: null, error: null };
    },
  };
  return { client, writes, rpcCalls, getRequest: () => request };
}


const BODY = "בקשה לפתיחת מערכת\nמספר מערכת: 0882309477\nטלפון פונה: 0527673952";

describe("normalizeSourceRequestType", () => {
  it("maps the Gmail label to the request type", () => {
    expect(normalizeSourceRequestType("pticha")).toBe("pticha");
    expect(normalizeSourceRequestType("מספרים לפתיחה")).toBe("pticha");
    expect(normalizeSourceRequestType("sgira")).toBe("sgira");
    expect(normalizeSourceRequestType("מספרים לחסימה")).toBe("sgira");
  });

  it("returns null for unknown or empty labels — never a silent default", () => {
    expect(normalizeSourceRequestType("")).toBeNull();
    expect(normalizeSourceRequestType(null)).toBeNull();
    expect(normalizeSourceRequestType("newsletter")).toBeNull();
  });
});

describe("ingestSystemRequest", () => {
  it("rejects a payload with no message id", async () => {
    const { client } = makeClient({});
    const res = await ingestSystemRequest(client, { gmailMessageId: "" } as any);
    expect(res.ok).toBe(false);
    expect(res.completed).toBe(false);
  });

  it("flags a conflict between the Gmail label and the email body", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "live" } },
      systems: [{ id: "sys-1", status: "closed" }],
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m1",
      body: BODY, // says pticha
      sourceRequestType: "sgira", // label says otherwise
    });
    expect(res.decision).toBe("needs_decision");
    // No status change was attempted on the conflicting request.
    expect(writes.some((w) => w.table === "systems")).toBe(false);
  });

  it("performs no operational write in dry-run mode", async () => {
    const { client, writes, rpcCalls } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [{ id: "r1", crm_key: "yemot", request_type: "pticha", from_status: "closed", action: "set_status", to_status: "open", is_active: true, sort_order: 1 }],
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m2",
      body: BODY,
      sourceRequestType: "pticha",
    });
    expect(res.ok).toBe(true);
    expect(res.decision).toBe("needs_decision");
    expect(res.proposed).toBe("set_status");
    // Only the request row itself is written; the system is untouched.
    expect(writes.every((w) => w.table === "system_requests")).toBe(true);
    expect(rpcCalls.some((c) => c.fn === "apply_request_status_change")).toBe(false);
    expect(rpcCalls.some((c) => c.fn === "add_request_caller_phone")).toBe(false);
  });

  it("creates nothing for an unknown system while in dry run", async () => {
    const { client, writes } = makeClient({
      settings: {
        request_automation_mode: { mode: "dry_run" },
        request_default_status_pticha: { status: "open" },
      },
      systems: [],
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m3",
      body: BODY,
      sourceRequestType: "pticha",
    });
    expect(res.wouldCreate).toBe(true);
    expect(writes.some((w) => w.table === "systems")).toBe(false);
  });

  it("does not act while the automation is off", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "off" } },
      systems: [{ id: "sys-1", status: "closed" }],
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m4",
      body: BODY,
      sourceRequestType: "pticha",
    });
    expect(res.mode).toBe("off");
    expect(res.decision).toBe("needs_decision");
    expect(writes.some((w) => w.table === "systems")).toBe(false);
  });

  it("treats an already-processed message as a completed duplicate", async () => {
    const { client } = makeClient({
      settings: { request_automation_mode: { mode: "live" } },
      existingRequest: { id: "req-1", processing_state: "done", decision_status: "auto_applied" },
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "m5", body: BODY });
    expect(res).toMatchObject({ ok: true, completed: true, duplicate: true });
  });
});

describe("ingestSystemRequest — failure handling and resume", () => {
  const LIVE = { request_automation_mode: { mode: "live" } };

  it("records the create proposal in dry run without creating the system", async () => {
    const { client, writes, getRequest } = makeClient({
      settings: {
        request_automation_mode: { mode: "dry_run" },
        request_default_status_pticha: { status: "open" },
      },
      systems: [],
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c1", body: BODY, sourceRequestType: "pticha" });
    expect(res.wouldCreate).toBe(true);
    expect(getRequest().proposed_action).toBe("create_system");
    expect(getRequest().proposed_status).toBe("open");
    expect(writes.some((w) => w.table === "systems")).toBe(false);
  });

  it("creates an unknown system once in live mode and skips the rule engine", async () => {
    const { client, writes, rpcCalls, getRequest } = makeClient({
      settings: { ...LIVE, request_default_status_pticha: { status: "open" } },
      systems: [],
      // A rule that would move it elsewhere must NOT run for a new system.
      rules: [{ id: "r1", crm_key: "yemot", request_type: "pticha", from_status: "open", action: "set_status", to_status: "problem", is_active: true, sort_order: 1 }],
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c2", body: BODY, sourceRequestType: "pticha" });
    expect(res.created).toBe(true);
    expect(res.newStatus).toBe("open");
    expect(writes.filter((w) => w.table === "systems" && w.op === "insert")).toHaveLength(1);
    expect(rpcCalls.some((c) => c.fn === "apply_request_status_change")).toBe(false);
    expect(getRequest().decision_status).toBe("auto_applied");
  });

  it("fails and asks for a retry when a state write cannot be persisted", async () => {
    const { client } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [{ id: "r1", crm_key: "yemot", request_type: "pticha", from_status: "closed", action: "set_status", to_status: "open", is_active: true, sort_order: 1 }],
      updateError: "connection reset",
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c3", body: BODY, sourceRequestType: "pticha" });
    expect(res.ok).toBe(false);
    expect(res.completed).toBe(false);
    expect(res.retry).toBe(true);
  });

  it("retries when adding the caller phone fails technically", async () => {
    const { client } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [{ id: "r1", crm_key: "yemot", request_type: "pticha", from_status: "closed", action: "set_status", to_status: "open", is_active: true, sort_order: 1 }],
      rpcErrors: { add_request_caller_phone: "deadlock detected" },
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c4", body: BODY, sourceRequestType: "pticha" });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
  });

  it("retries when the status RPC fails technically", async () => {
    const { client } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [{ id: "r1", crm_key: "yemot", request_type: "pticha", from_status: "closed", action: "set_status", to_status: "open", is_active: true, sort_order: 1 }],
      rpcErrors: { apply_request_status_change: "server closed the connection" },
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c5", body: BODY, sourceRequestType: "pticha" });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
  });

  it("asks for a human decision when the status moved meanwhile (CAS returned false)", async () => {
    const { client } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [{ id: "r1", crm_key: "yemot", request_type: "pticha", from_status: "closed", action: "set_status", to_status: "open", is_active: true, sort_order: 1 }],
      rpcResults: { apply_request_status_change: false },
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c6", body: BODY, sourceRequestType: "pticha" });
    expect(res.ok).toBe(true);
    expect(res.completed).toBe(true);
    expect(res.decision).toBe("needs_decision");
  });

  it("resumes from a matched request without re-running the rule engine", async () => {
    const { client, rpcCalls } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "problem" }], // moved since matching
      // Rules that would now propose something different are not consulted.
      rules: [{ id: "r9", crm_key: "yemot", request_type: "pticha", from_status: "problem", action: "ignore", to_status: null, is_active: true, sort_order: 1 }],
      existingRequest: {
        id: "req-1", processing_state: "matched", last_completed_state: "matched",
        request_type: "pticha", system_id: "sys-1", prev_status: "closed",
        proposed_action: "set_status", proposed_status: "open", rule_id: "r1",
        phone_added_at: new Date().toISOString(),
      },
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c7", body: BODY, sourceRequestType: "pticha" });
    expect(res.decision).toBe("auto_applied");
    expect(res.newStatus).toBe("open");
    expect(rpcCalls.some((c) => c.fn === "find_systems_by_code_key")).toBe(false);
  });

  it("only finishes side effects when the status was already applied", async () => {
    const { client, rpcCalls } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "open" }],
      existingRequest: {
        id: "req-1", processing_state: "applied", last_completed_state: "status_applied",
        system_id: "sys-1", new_status: "open", decision_status: "auto_applied",
        status_applied_at: new Date().toISOString(),
      },
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c8", body: BODY, sourceRequestType: "pticha" });
    expect(res.resumed).toBe(true);
    expect(rpcCalls.some((c) => c.fn === "apply_request_status_change")).toBe(false);
  });

  it("does not stamp side effects as complete when the auto-assignment fails", async () => {
    const autoAssign = await import("@/lib/auto-assign.server");
    (autoAssign.resolveAutoAssign as any).mockResolvedValueOnce({ agentId: "a1", otherAgentIds: [] });
    (autoAssign as any).applyAutoStatusAssignment.mockRejectedValueOnce(new Error("rpc down"));
    const { client, writes } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [{ id: "r1", crm_key: "yemot", request_type: "pticha", from_status: "closed", action: "set_status", to_status: "open", is_active: true, sort_order: 1 }],
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "c9", body: BODY, sourceRequestType: "pticha" });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
    const stamped = writes.some((w) => w.op === "update" && w.payload.side_effects_completed_at);
    expect(stamped).toBe(false);
  });
});
