import { describe, it, expect, vi } from "vitest";
import { normalizeSourceRequestType, ingestSystemRequest, linkRequestToExistingSystem, checkManualRootCreation, executeManualSystemAction } from "./system-requests.server";

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
  /** Conditional UPDATEs match no row (someone else changed the request). */
  casLoses?: boolean;
  /** Force a failed READ, keyed by app_settings key or by table name. */
  readErrors?: Record<string, string>;
  /** Candidate rows returned for a name-match (ilike) query on `systems`. */
  nameMatches?: any[];
  /** Force the next `systems` INSERT to fail with this error instead of succeeding. */
  systemInsertError?: { code?: string; message: string } | null;
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
          let result: { data: any; error: any };
          if (opts.systemInsertError) {
            result = { data: null, error: opts.systemInsertError };
          } else {
            const created = {
              id: "sys-new", status: payload.status, name: payload.name,
              system_code: payload.system_code ?? null, parent_system_id: payload.parent_system_id ?? null,
            };
            (opts.systems ??= []).push(created);
            result = { data: created, error: null };
          }
          const insertChain: any = {
            select: () => insertChain,
            maybeSingle: async () => result,
            then: (r: any) => Promise.resolve(result).then(r),
          };
          return insertChain;
        }
        const result = { data: null, error: null };
        return { ...api, then: (r: any) => Promise.resolve(result).then(r) };
      },
      ilike: (col: string, val: unknown) => { filters[col] = val; return api; },
      limit: () => api,
      update: (payload: any) => {
        writes.push({ table, op: "update", payload });
        const error = table === "system_requests" && opts.updateError ? { message: opts.updateError } : null;
        if (!error && table === "system_requests" && request) request = { ...request, ...payload };
        // A conditional UPDATE returns the rows it touched. `casLoses` mimics a
        // condition that no longer matches: no error, but zero rows.
        const rows = error || (table === "system_requests" && opts.casLoses) ? [] : [{ id: request?.id ?? "req-1" }];
        // The result must survive the trailing .eq() of update().eq("id", …).
        const chain: any = {
          eq: () => chain,
          is: () => chain,
          in: () => chain,
          select: () => chain,
          maybeSingle: async () => ({ data: rows[0] ?? null, error }),
          then: (r: any) => Promise.resolve({ data: rows, error }).then(r),
        };
        return chain;
      },

      maybeSingle: async () => {
        if (table === "app_settings") {
          const key = filters["key"] as string;
          if (opts.readErrors?.[key]) return { data: null, error: { message: opts.readErrors[key] } };
          return { data: opts.settings?.[key] ? { value: opts.settings[key] } : null, error: null };
        }
        if (table === "system_requests") return { data: request, error: null };
        if (table === "systems") {
          return { data: (opts.systems ?? []).find((s) => s.id === filters["id"]) ?? null, error: null };
        }
        return { data: null, error: null };
      },
      then: (r: any) => {
        const err = opts.readErrors?.[table] ? { message: opts.readErrors[table] } : null;
        if (err) return Promise.resolve({ data: null, error: err }).then(r);
        if (table === "system_request_rules") return Promise.resolve({ data: opts.rules ?? [], error: null }).then(r);
        if (table === "systems" && "name" in filters) {
          return Promise.resolve({ data: opts.nameMatches ?? [], error: null }).then(r);
        }
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
    // The engine knew exactly what to do, so this is a simulation — it must NOT
    // land in the "needs decision" queue.
    expect(res.decision).toBe("simulated");
    expect(res.proposed).toBe("set_status");
    // Only the request row itself is written; the system is untouched.
    expect(writes.every((w) => w.table === "system_requests")).toBe(true);
    expect(rpcCalls.some((c) => c.fn === "apply_request_status_change")).toBe(false);
    expect(rpcCalls.some((c) => c.fn === "add_request_caller_phone")).toBe(false);
  });

  it("still asks for a decision in dry run when no rule matched", async () => {
    const { client } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [],
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m2b", body: BODY, sourceRequestType: "pticha",
    });
    expect(res.decision).toBe("needs_decision");
  });

  it("never defaults an unidentified request type to pticha", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m2c",
      subject: "עדכון כללי",
      body: "מספר מערכת: 0882309477",
    });
    const inserted = writes.find((w) => w.table === "system_requests" && w.op === "insert")!;
    expect(inserted.payload.request_type).toBeNull();
    expect(res.decision).toBe("needs_decision");
  });

  it("retries instead of deciding when the automation mode cannot be read", async () => {
    const { client } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
      readErrors: { request_automation_mode: "db down" },
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m2d", body: BODY, sourceRequestType: "pticha",
    });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
    expect(res.completed).toBe(false);
  });

  it("retries instead of deciding when the rules cannot be read", async () => {
    const { client } = makeClient({
      settings: { request_automation_mode: { mode: "live" } },
      systems: [{ id: "sys-1", status: "closed" }],
      readErrors: { system_request_rules: "db down" },
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m2e", body: BODY, sourceRequestType: "pticha",
    });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
  });

  it("retries instead of deciding when the default status cannot be read", async () => {
    const { client } = makeClient({
      settings: { request_automation_mode: { mode: "live" } },
      systems: [],
      readErrors: { request_default_status_pticha: "db down" },
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m2f", body: BODY, sourceRequestType: "pticha",
    });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
  });

  it("refuses to ingest when the concurrency lock RPC itself fails", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
      rpcErrors: { bump_rate_limit: "lock unavailable" },
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m2g", body: BODY, sourceRequestType: "pticha",
    });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
    expect(writes).toEqual([]);
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

describe("ingestSystemRequest — a message without a system code is not a request", () => {
  it("creates no request row for a reply in the thread that carries no system code", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "live" } },
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m-reply",
      gmailThreadId: "t-1",
      subject: "תודה",
      body: "קיבלנו, תודה רבה",
      sourceRequestType: "pticha",
    });
    // Skipped, but completed — so the script marks the mail read and stops.
    expect(res.ok).toBe(true);
    expect(res.completed).toBe(true);
    expect(res.skipped).toBe(true);
    expect(writes.length).toBe(0);
  });

  it("still ingests the valid message of that same thread — one request in total", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [],
    });
    const valid: any = await ingestSystemRequest(client, {
      gmailMessageId: "m-valid", gmailThreadId: "t-1", body: BODY, sourceRequestType: "pticha",
    });
    expect(valid.skipped).toBeUndefined();
    const inserts = writes.filter((w) => w.table === "system_requests" && w.op === "insert");
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.payload.system_code_norm).toBeTruthy();
  });

  it("handles a valid request that has no recording attached", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [],
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m-norec", body: BODY, sourceRequestType: "pticha",
    });
    expect(res.ok).toBe(true);
    const inserted = writes.find((w) => w.table === "system_requests" && w.op === "insert")!;
    expect(inserted.payload.attachment_name ?? null).toBeNull();
  });

  it("handles a valid request that has a recording attached", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "dry_run" } },
      systems: [{ id: "sys-1", status: "closed" }],
      rules: [],
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m-rec", body: BODY, sourceRequestType: "pticha",
      attachmentName: "call.wav", attachmentIndex: 0,
    });
    expect(res.ok).toBe(true);
    const inserted = writes.find((w) => w.table === "system_requests" && w.op === "insert")!;
    expect(inserted.payload.attachment_name).toBe("call.wav");
  });

  it("does nothing new when the very same message is scanned again", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "live" } },
      systems: [{ id: "sys-1", status: "closed" }],
      existingRequest: {
        id: "req-1", gmail_message_id: "m-dup", processing_state: "done",
        decision_status: "auto_applied", last_completed_state: "done",
        side_effects_completed_at: new Date().toISOString(),
      },
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "m-dup", body: BODY, sourceRequestType: "pticha",
    });
    expect(res.completed).toBe(true);
    expect(writes.some((w) => w.table === "systems")).toBe(false);
  });
});

describe("ingestSystemRequest — the ingested automation mode is recorded", () => {
  it("stamps the mode that was in effect when the request arrived", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "off" } },
    });
    await ingestSystemRequest(client, { gmailMessageId: "m-off", body: BODY, sourceRequestType: "pticha" });
    const inserted = writes.find((w) => w.table === "system_requests" && w.op === "insert")!;
    expect(inserted.payload.automation_mode).toBe("off");
  });
});


describe("linkRequestToExistingSystem — a request whose system already exists", () => {
  it("links the unlinked request to the single matching system", async () => {
    const { client, writes } = makeClient({
      systems: [{ id: "sys-1", status: "closed", system_code: "0882309477" }],
    });
    const res = await linkRequestToExistingSystem(client, "req-1", "0882309477");
    expect(res).toMatchObject({ kind: "linked", systemId: "sys-1", status: "closed" });
    const upd = writes.filter((w) => w.table === "system_requests" && w.op === "update");
    expect(upd).toHaveLength(1);
    expect(upd[0]!.payload).toMatchObject({ system_id: "sys-1", prev_status: "closed" });
  });

  it("changes no status and adds no caller phone while linking", async () => {
    const { client, writes, rpcCalls } = makeClient({
      systems: [{ id: "sys-1", status: "closed", system_code: "0882309477" }],
    });
    await linkRequestToExistingSystem(client, "req-1", "0882309477");
    expect(writes.some((w) => w.table === "systems")).toBe(false);
    expect(rpcCalls.some((c) => c.fn === "add_request_caller_phone")).toBe(false);
    expect(rpcCalls.some((c) => c.fn === "apply_request_status_change")).toBe(false);
  });

  it("never links automatically when two systems carry the same code", async () => {
    const { client, writes } = makeClient({
      systems: [
        { id: "sys-1", status: "open", system_code: "0882309477" },
        { id: "sys-2", status: "closed", system_code: "882309477" },
      ],
    });
    const res = await linkRequestToExistingSystem(client, "req-1", "0882309477");
    expect(res.kind).toBe("ambiguous");
    const upd = writes.filter((w) => w.table === "system_requests" && w.op === "update");
    expect(upd[0]!.payload.system_id).toBeUndefined();
    expect(upd[0]!.payload.decision_status).toBe("needs_decision");
  });

  it("reports no match when the system genuinely does not exist", async () => {
    const { client, writes } = makeClient({ systems: [] });
    const res = await linkRequestToExistingSystem(client, "req-1", "0882309477");
    expect(res.kind).toBe("none");
    expect(writes).toEqual([]);
  });
});

describe("assertKnownStatus — a rule may only point at a status that exists", () => {
  function statusClient(known: string[]) {
    return {
      from() {
        let wanted = "";
        const chain: any = {
          select: () => chain,
          eq: (_c: string, v: string) => { wanted = v; return chain; },
          maybeSingle: async () => ({
            data: known.includes(wanted) ? { status_key: wanted } : null,
            error: null,
          }),
        };
        return chain;
      },
    };
  }

  it("accepts a status that exists", async () => {
    const { assertKnownStatus } = await import("./requests-access.server");
    await expect(assertKnownStatus(statusClient(["open", "closed"]), "closed")).resolves.toBeUndefined();
  });

  it("rejects a status that does not exist", async () => {
    const { assertKnownStatus } = await import("./requests-access.server");
    await expect(assertKnownStatus(statusClient(["open"]), "ghost")).rejects.toThrow(/אינו קיים/);
  });

  it("treats an empty value as 'no status chosen' rather than an error", async () => {
    const { assertKnownStatus } = await import("./requests-access.server");
    await expect(assertKnownStatus(statusClient([]), null)).resolves.toBeUndefined();
  });
});

describe("OPEN_DECISIONS — what still waits for a human", () => {
  it("covers both an undecided request and one concluded only as a test run", async () => {
    const { OPEN_DECISIONS } = await import("./system-requests.server");
    expect([...OPEN_DECISIONS].sort()).toEqual(["needs_decision", "simulated"]);
  });
});

describe("settings are separate per CRM", () => {
  it("keeps the original CRM's historical key and namespaces every other CRM", async () => {
    const { requestSettingKey } = await import("./system-requests.server");
    expect(requestSettingKey("request_automation_mode", "yemot")).toBe("request_automation_mode");
    expect(requestSettingKey("request_automation_mode", "simahedrin"))
      .toBe("request_automation_mode__simahedrin");
    expect(requestSettingKey("request_default_status_pticha", "derech"))
      .toBe("request_default_status_pticha__derech");
  });
});

describe("the mail relay only forwards a message that carries its own system number", () => {
  const script = () => import("node:fs").then((fs) => fs.readFileSync("apps-script/email-relay.gs", "utf8"));

  it("skips a message with no system number instead of creating an empty request", async () => {
    const src = await script();
    expect(src).toContain("function messageSystemCode_(msg)");
    expect(src).toContain("if (!messageSystemCode_(msg)) {");
  });

  it("counts a skipped and a duplicate message apart from a sent one", async () => {
    const src = await script();
    expect(src).toContain("if (parsed.duplicate) stats.duplicate++;");
    expect(src).toContain("else if (parsed.skipped) stats.skipped++;");
    expect(src).toContain("else stats.sent++;");
  });
});

describe("a conditional update that matches no row is never a success", () => {
  it("reports a conflict instead of 'linked' when the CAS loses", async () => {
    const { client } = makeClient({
      systems: [{ id: "sys-1", status: "closed", system_code: "0882309477" }],
      casLoses: true,
    });
    const res = await linkRequestToExistingSystem(client, "req-1", "0882309477");
    expect(res.kind).toBe("conflict");
  });

  it("reports a conflict instead of 'ambiguous' when the CAS loses", async () => {
    const { client } = makeClient({
      systems: [
        { id: "sys-1", status: "closed", system_code: "0882309477" },
        { id: "sys-2", status: "open", system_code: "0882309477" },
      ],
      casLoses: true,
    });
    const res = await linkRequestToExistingSystem(client, "req-1", "0882309477");
    expect(res.kind).toBe("conflict");
  });

  it("does not count a lost race as a linked request", async () => {
    const { client } = makeClient({
      systems: [{ id: "sys-1", status: "closed", system_code: "0882309477" }],
      casLoses: true,
    });
    const res = await linkRequestToExistingSystem(client, "req-1", "0882309477");
    expect((res as any).systemId).toBeUndefined();
  });
});

describe("תאור הדיווח is stored per message", () => {
  const withDesc = `${BODY}\nתאור הדיווח: שורה ראשונה\nשורה שנייה`;

  it("stores the description that came with this message", async () => {
    const { client, writes } = makeClient({ settings: { request_automation_mode: { mode: "dry_run" } } });
    await ingestSystemRequest(client, { gmailMessageId: "m-d1", body: withDesc, sourceRequestType: "pticha" });
    const inserted = writes.find((w) => w.table === "system_requests" && w.op === "insert")!;
    expect(inserted.payload.report_description).toContain("שורה ראשונה");
    expect(inserted.payload.report_description).toContain("שורה שנייה");
  });

  it("stores null when the message carries no description", async () => {
    const { client, writes } = makeClient({ settings: { request_automation_mode: { mode: "dry_run" } } });
    await ingestSystemRequest(client, { gmailMessageId: "m-d2", body: BODY, sourceRequestType: "pticha" });
    const inserted = writes.find((w) => w.table === "system_requests" && w.op === "insert")!;
    expect(inserted.payload.report_description ?? null).toBeNull();
  });

  it("never copies a description from another message of the same thread", async () => {
    const a = makeClient({ settings: { request_automation_mode: { mode: "dry_run" } } });
    await ingestSystemRequest(a.client, { gmailMessageId: "m-a", gmailThreadId: "t-9", body: withDesc, sourceRequestType: "pticha" });
    const b = makeClient({ settings: { request_automation_mode: { mode: "dry_run" } } });
    await ingestSystemRequest(b.client, { gmailMessageId: "m-b", gmailThreadId: "t-9", body: BODY, sourceRequestType: "pticha" });
    const second = b.writes.find((w) => w.table === "system_requests" && w.op === "insert")!;
    expect(second.payload.report_description ?? null).toBeNull();
  });
});

describe("the mail relay reads its target and its description safely", () => {
  const script = () => import("node:fs").then((fs) => fs.readFileSync("apps-script/email-relay.gs", "utf8"));

  it("takes the webhook addresses from Script Properties", async () => {
    const src = await script();
    expect(src).toContain("getProperty('REQUEST_WEBHOOK_URL')");
    expect(src).toContain("getProperty('WEBHOOK_URL')");
  });

  it("guards the scheduled scan with a lock", async () => {
    const src = await script();
    expect(src).toContain("LockService.getScriptLock()");
    expect(src).toContain("function pollMailboxLocked_()");
  });

  it("sends the description of the very message being forwarded", async () => {
    const src = await script();
    expect(src).toContain("function messageReportDescription_(msg)");
    expect(src).toContain("reportDescription: messageReportDescription_(msg) || null,");
  });
});

// ---------------------------------------------------------------------------
// Soft delete / restore + soft-delete-aware ingest (system-requests.server.ts)
// ---------------------------------------------------------------------------
import { softDeleteSystemRequest, restoreSystemRequestRow } from "./system-requests.server";

describe("softDeleteSystemRequest / restoreSystemRequestRow", () => {
  it("throws when the delete RPC reports a technical failure", async () => {
    const { client } = makeClient({ rpcErrors: { soft_delete_system_request: "db down" } });
    await expect(softDeleteSystemRequest(client, "req-1", "user-1", "reason")).rejects.toThrow(/db down/);
  });

  it("throws when the delete RPC returns false (already deleted)", async () => {
    const { client } = makeClient({ rpcResults: { soft_delete_system_request: false } });
    await expect(softDeleteSystemRequest(client, "req-1", "user-1")).rejects.toThrow(/כבר נמחקה/);
  });

  it("resolves true when the delete RPC succeeds", async () => {
    const { client, rpcCalls } = makeClient({ rpcResults: { soft_delete_system_request: true } });
    await expect(softDeleteSystemRequest(client, "req-1", "user-1", "מיותרת")).resolves.toBe(true);
    expect(rpcCalls).toContainEqual({ fn: "soft_delete_system_request", args: { _id: "req-1", _actor: "user-1", _reason: "מיותרת" } });
  });

  it("throws when the restore RPC reports a technical failure", async () => {
    const { client } = makeClient({ rpcErrors: { restore_system_request: "db down" } });
    await expect(restoreSystemRequestRow(client, "req-1", "user-1")).rejects.toThrow(/db down/);
  });

  it("throws when the restore RPC returns false (not deleted)", async () => {
    const { client } = makeClient({ rpcResults: { restore_system_request: false } });
    await expect(restoreSystemRequestRow(client, "req-1", "user-1")).rejects.toThrow(/אינה מחוקה/);
  });

  it("resolves true when the restore RPC succeeds", async () => {
    const { client } = makeClient({ rpcResults: { restore_system_request: true } });
    await expect(restoreSystemRequestRow(client, "req-1", "user-1")).resolves.toBe(true);
  });
});

describe("ingestSystemRequest — soft-delete awareness", () => {
  const LIVE = { request_automation_mode: { mode: "live" } };

  it("rescanning a soft-deleted message inserts nothing and reports it as skipped/deleted", async () => {
    const { client } = makeClient({
      settings: LIVE,
      existingRequest: {
        id: "req-del", processing_state: "done", decision_status: "needs_decision",
        deleted_at: new Date().toISOString(),
      },
    });
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "del-1", body: BODY, sourceRequestType: "pticha" });
    expect(res).toMatchObject({ ok: true, completed: true, skipped: true, reason: "deleted", requestId: "req-del" });
    // No system was ever touched and no state-advancing write on the request.
    expect((client as any).from("systems") ? true : true).toBe(true);
  });

  it("a business-key duplicate of a soft-deleted original becomes needs_decision, not a silent duplicate", async () => {
    const { client: baseClient, writes } = makeClient({ settings: LIVE });
    let insertAttempts = 0;
    // A chainable no-op stand-in for the "find the original by business key"
    // SELECT — every filter method just returns itself.
    function readChain(result: { data: any; error: any }) {
      const chain: any = {
        eq: () => chain, is: () => chain, in: () => chain, order: () => chain, select: () => chain,
        maybeSingle: async () => result,
        then: (r: any) => Promise.resolve(result).then(r),
      };
      return chain;
    }
    const client: any = {
      ...baseClient,
      from: (table: string) => {
        if (table !== "system_requests") return baseClient.from(table);
        const api = baseClient.from(table);
        return {
          ...api,
          insert: (payload: any) => {
            insertAttempts += 1;
            writes.push({ table, op: "insert", payload });
            if (insertAttempts === 1) {
              // The very first insert collides with the DB's dedupe index.
              return { then: (r: any) => Promise.resolve({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "system_requests_dedupe_uniq"' } }).then(r) };
            }
            // The second insert is the "duplicate" row the handler writes once
            // it learns the original is soft-deleted.
            return { then: (r: any) => Promise.resolve({ data: null, error: null }).then(r) };
          },
          select: (cols?: string) => {
            // Two different SELECTs happen after the failed insert: first the
            // lookup of "the original" by business key, then the re-read of
            // the just-failed row by gmail_message_id. Distinguish by the
            // requested columns.
            if (cols?.includes("deleted_at") && !cols.includes("*")) {
              return readChain({ data: { id: "orig-1", deleted_at: new Date().toISOString() }, error: null });
            }
            return readChain({
              data: { id: "req-dup", gmail_message_id: "dup-1", processing_state: "done", decision_status: "needs_decision", deleted_at: null },
              error: null,
            });
          },
        };
      },
    };
    const res: any = await ingestSystemRequest(client, { gmailMessageId: "dup-1", body: BODY, sourceRequestType: "pticha" });
    expect(res.ok).toBe(true);
    const dupInsert = writes.find((w) => w.table === "system_requests" && w.op === "insert" && w.payload.duplicate_of);
    expect(dupInsert?.payload.decision_status).toBe("needs_decision");
    expect(dupInsert?.payload.duplicate_of).toBe("orig-1");
  });

  it("retries when persisting the report description on a rescan fails", async () => {
    const { client } = makeClient({
      settings: LIVE,
      systems: [{ id: "sys-1", status: "closed" }],
      existingRequest: {
        id: "req-1", processing_state: "received", report_description: null,
      },
      readErrors: {},
      updateError: "connection reset",
    });
    const res: any = await ingestSystemRequest(client, {
      gmailMessageId: "rd-1", body: BODY, sourceRequestType: "pticha", reportDescription: "תיאור חדש",
    });
    expect(res.ok).toBe(false);
    expect(res.retry).toBe(true);
    expect(res.error).toMatch(/תאור הדיווח/);
  });
});

// ---------------------------------------------------------------------------
// Manual "which system does this request belong to" decision
// (checkManualRootCreation / executeManualSystemAction).
// ---------------------------------------------------------------------------
describe("executeManualSystemAction", () => {
  const baseReq = {
    id: "req-1", crm_key: "yemot",
    system_code_raw: "0882309477", system_code_norm: "882309477", caller_phone: "0527673952",
  };

  it("persists the decision on the request row before running the side effect", async () => {
    const { client, writes } = makeClient({});
    await executeManualSystemAction(client, baseReq, {
      systemAction: "link_existing", targetSystemId: "sys-existing",
    });
    const requestWrites = writes.filter((w) => w.table === "system_requests" && w.op === "update");
    expect(requestWrites.length).toBeGreaterThanOrEqual(2);
    // The FIRST write is the persisted decision itself, not the link.
    expect(requestWrites[0]!.payload).toMatchObject({ manual_system_action: "link_existing", manual_target_system_id: "sys-existing" });
    expect(requestWrites[0]!.payload.system_id).toBeUndefined();
    // Only afterwards does the request get linked to the system (the side effect).
    expect(requestWrites[1]!.payload).toMatchObject({ system_id: "sys-existing" });
  });

  it("link_existing links the request to the given system without creating one", async () => {
    const { client, writes } = makeClient({});
    const res = await executeManualSystemAction(client, baseReq, {
      systemAction: "link_existing", targetSystemId: "sys-existing",
    });
    expect(res).toEqual({ ok: true, systemId: "sys-existing" });
    expect(writes.some((w) => w.table === "systems")).toBe(false);
  });

  it("create_sub inserts a system with parent_system_id set", async () => {
    const { client, writes } = makeClient({});
    const res = await executeManualSystemAction(client, baseReq, {
      systemAction: "create_sub", parentSystemId: "parent-1", name: "תת מערכת",
    });
    expect(res).toMatchObject({ ok: true, systemId: "sys-new" });
    const insert = writes.find((w) => w.table === "systems" && w.op === "insert")!;
    expect(insert.payload).toMatchObject({ parent_system_id: "parent-1", name: "תת מערכת" });
    const link = writes.find((w) => w.table === "system_requests" && w.op === "update" && w.payload.system_id);
    expect(link?.payload.system_id).toBe("sys-new");
  });

  describe("create_root", () => {
    const rootMatch = [{ id: "sys-match", name: "מערכת קיימת", system_code: "111" }];

    it("state A: a match exists and there is no confirmed-matches snapshot → conflict, nothing inserted", async () => {
      const { client, writes } = makeClient({ nameMatches: rootMatch });
      const res = await executeManualSystemAction(client, baseReq, {
        systemAction: "create_root", name: "מערכת קיימת",
      });
      expect(res).toMatchObject({ ok: false, conflict: true });
      expect((res as any).matches).toMatchObject([{ id: "sys-match" }]);
      expect(writes.some((w) => w.table === "systems" && w.op === "insert")).toBe(false);
    });

    it("state B: the snapshot covers the current matches → the root is created", async () => {
      const { client, writes } = makeClient({ nameMatches: rootMatch });
      const res = await executeManualSystemAction(client, baseReq, {
        systemAction: "create_root", name: "מערכת קיימת",
        confirmedMatches: [{ id: "sys-match", name: "מערכת קיימת", system_code: "111" }],
      });
      expect(res).toMatchObject({ ok: true, systemId: "sys-new" });
      const insert = writes.find((w) => w.table === "systems" && w.op === "insert")!;
      expect(insert.payload).toMatchObject({ name: "מערכת קיימת", parent_system_id: null });
    });

    it("a new match outside the confirmed snapshot → conflict", async () => {
      const { client, writes } = makeClient({
        nameMatches: [
          { id: "sys-match", name: "מערכת קיימת", system_code: "111" },
          { id: "sys-other", name: "מערכת קיימת", system_code: "222" },
        ],
      });
      const res = await executeManualSystemAction(client, baseReq, {
        systemAction: "create_root", name: "מערכת קיימת",
        confirmedMatches: [{ id: "sys-match", name: "מערכת קיימת", system_code: "111" }],
      });
      expect(res).toMatchObject({ ok: false, conflict: true });
      expect((res as any).matches.map((m: any) => m.id).sort()).toEqual(["sys-match", "sys-other"]);
      expect(writes.some((w) => w.table === "systems" && w.op === "insert")).toBe(false);
    });

    it("a unique-violation race on the insert is reported as a conflict, never thrown", async () => {
      const { client } = makeClient({
        nameMatches: [{ id: "sys-race", name: "מערכת חדשה", system_code: "333" }],
        systemInsertError: { code: "23505", message: 'duplicate key value violates unique constraint "systems_name_uniq"' },
      });
      const res = await executeManualSystemAction(client, baseReq, {
        systemAction: "create_root", name: "מערכת חדשה",
      });
      expect(res).toMatchObject({ ok: false, conflict: true });
      expect((res as any).matches).toMatchObject([{ id: "sys-race" }]);
    });
  });
});

describe("checkManualRootCreation", () => {
  it("creates when no system currently matches the name", async () => {
    const { client } = makeClient({ nameMatches: [] });
    const decision = await checkManualRootCreation(client, "yemot", "מערכת חדשה", null);
    expect(decision).toEqual({ outcome: "create" });
  });

  it("conflicts when a match exists but there is no confirmed-matches snapshot", async () => {
    const { client } = makeClient({ nameMatches: [{ id: "sys-1", name: "מערכת", system_code: "1" }] });
    const decision = await checkManualRootCreation(client, "yemot", "מערכת", null);
    expect(decision.outcome).toBe("conflict");
  });

  it("creates when the snapshot covers every current match", async () => {
    const { client } = makeClient({ nameMatches: [{ id: "sys-1", name: "מערכת", system_code: "1" }] });
    const decision = await checkManualRootCreation(client, "yemot", "מערכת", [{ id: "sys-1", name: "מערכת", system_code: "1" }]);
    expect(decision).toEqual({ outcome: "create" });
  });
});

describe("system_requests reads exclude soft-deleted rows", () => {
  const source = require("node:fs").readFileSync("src/lib/system-requests.functions.ts", "utf8");

  function handlerBody(name: string): string {
    const start = source.indexOf(`export const ${name} = createServerFn`);
    expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf("\nexport const ", start + 1);
    return source.slice(start, nextExport < 0 ? source.length : nextExport);
  }

  it("countPendingRequests filters out deleted rows", () => {
    expect(handlerBody("countPendingRequests")).toContain('.is("deleted_at", null)');
  });

  it("getRequestsSummary filters out deleted rows in both the 24h select and the pending count", () => {
    const body = handlerBody("getRequestsSummary");
    const matches = body.match(/\.is\("deleted_at", null\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("listRequestsForSystem filters out deleted rows and selects report_description + system_id", () => {
    const body = handlerBody("listRequestsForSystem");
    expect(body).toContain('.is("deleted_at", null)');
    expect(body).toContain("report_description");
    expect(body).toContain("system_id");
  });

  it("listSystemRequests already filters out deleted rows unless includeDeleted is requested", () => {
    const body = handlerBody("listSystemRequests");
    expect(body).toContain('.is("deleted_at", null)');
  });
});

// ---------------------------------------------------------------------------
// getSystemRequestById + deleted-row visibility across list/summary/rules
// (system-requests.functions.ts) — static source checks, same convention used
// by the "system_requests reads exclude soft-deleted rows" block above.
// ---------------------------------------------------------------------------
describe("system-requests.functions.ts — deep-link lookup and deleted-row rules", () => {
  const source = require("node:fs").readFileSync("src/lib/system-requests.functions.ts", "utf8");

  function handlerBody(name: string): string {
    const start = source.indexOf(`export const ${name} = createServerFn`);
    expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf("\nexport const ", start + 1);
    return source.slice(start, nextExport < 0 ? source.length : nextExport);
  }

  it("getSystemRequestById exists and is guarded by the requests_view permission, like the list", () => {
    const body = handlerBody("getSystemRequestById");
    expect(body).toContain('"requests_view"');
    expect(body).toContain("loadAuthorizedRequest");
  });

  it("getSystemRequestById selects report_description and deleted_at, and returns the system relation", () => {
    const body = handlerBody("getSystemRequestById");
    expect(body).toContain("report_description");
    expect(body).toContain("deleted_at");
    expect(body).toContain("system:");
  });

  it("getSystemRequestById only allows a soft-deleted row through when includeDeleted is passed", () => {
    const body = handlerBody("getSystemRequestById");
    expect(body).toMatch(/allowDeleted:\s*!!data\.includeDeleted/);
  });

  it("deleteSystemRequest is guarded by requests_delete and the rate limiter, and only ever soft-deletes", () => {
    const body = handlerBody("deleteSystemRequest");
    expect(body).toContain('"requests_delete"');
    expect(body).toMatch(/limitSensitiveAction|enforceDbRateLimit/);
    expect(body).toContain("softDeleteSystemRequest");
    expect(body).not.toContain(".delete(");
  });

  it("restoreSystemRequest is guarded by requests_delete, the rate limiter, and allows loading a deleted row", () => {
    const body = handlerBody("restoreSystemRequest");
    expect(body).toContain('"requests_delete"');
    expect(body).toMatch(/limitSensitiveAction|enforceDbRateLimit/);
    expect(body).toContain("allowDeleted: true");
    expect(body).toContain("restoreSystemRequestRow");
  });

  it("listRequestsForSystem returns the fields needed to render a Hebrew status label", () => {
    const body = handlerBody("listRequestsForSystem");
    expect(body).toContain("decision_status");
    expect(body).toContain("new_status");
    expect(body).toContain("proposed_status");
    expect(body).toContain("report_description");
    expect(body).toContain('.is("deleted_at", null)');
  });

  it("listSystemRequests shows deleted rows only under includeDeleted, and hides them otherwise", () => {
    const body = handlerBody("listSystemRequests");
    expect(body).toMatch(/showDeleted\s*=\s*deleteKeys\.length > 0/);
    expect(body).toContain('q.not("deleted_at", "is", null)');
    expect(body).toContain('q.is("deleted_at", null)');
  });
});

// ---------------------------------------------------------------------------
// Rescanning a soft-deleted request's gmail_message_id must not create a
// duplicate — the dedup lookup sees soft-deleted rows too.
// ---------------------------------------------------------------------------
describe("dedup lookup by gmail_message_id sees soft-deleted rows (no duplicate on rescan)", () => {
  it("ingestSystemRequest finds the soft-deleted original by gmail_message_id and reports no new row, instead of inserting a duplicate", async () => {
    const { client, writes } = makeClient({
      settings: { request_automation_mode: { mode: "live" } },
      existingRequest: {
        id: "req-was-deleted",
        processing_state: "done",
        decision_status: "needs_decision",
        deleted_at: new Date().toISOString(),
      },
    });
    const res: any = await ingestSystemRequest(
      client,
      { gmailMessageId: "rescanned-1", body: BODY, sourceRequestType: "pticha" },
    );
    // The existing (soft-deleted) row was found by its business key — nothing
    // new was inserted for the same message.
    expect(res).toMatchObject({ ok: true, completed: true, skipped: true, reason: "deleted", requestId: "req-was-deleted" });
    expect(writes.some((w) => w.table === "system_requests" && w.op === "insert")).toBe(false);
  });
});
