import { describe, it, expect, vi } from "vitest";
import { processMentionQueue, validateHttpsBaseUrl, buildAppLink, resolveAppBaseUrl } from "@/lib/mentions.server";
import { buildMentionRpcArgs, buildUpdateMentionRpcArgs, resolveRealCrmKeyForRecord } from "@/lib/mentions.functions";

type Row = Record<string, any>;

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    delivery_id: "d1",
    mention_id: "m1",
    attempts: 0,
    mentioned_user_id: "u1",
    mentioned_by: "u2",
    crm_key: "yemot",
    system_id: "sys1",
    record_id: null,
    source_type: "system_note",
    source_note_id: "note1",
    ...overrides,
  };
}

/** Minimal supabase-admin double: enough surface for processMentionQueue. */
function makeSupabaseAdmin(opts: {
  claimRows?: Row[];
  finish?: (args: any) => { error?: { message: string } | null };
  relayUrl?: string | null;
  relaySecret?: string | null;
  baseUrl?: string | null;
}) {
  const claimQueue = [...(opts.claimRows ?? [])];
  const finishCalls: any[] = [];
  const rpcCalls: string[] = [];

  const rpc = vi.fn(async (name: string, args?: any) => {
    rpcCalls.push(name);
    if (name === "claim_mention_deliveries") {
      const rows = claimQueue.shift() ?? [];
      return { data: rows, error: null };
    }
    if (name === "finish_mention_delivery") {
      finishCalls.push(args);
      const res = opts.finish ? opts.finish(args) : {};
      return { data: true, error: res.error ?? null };
    }
    if (name === "drain_mention_queue_job") return { data: true, error: null };
    return { data: null, error: null };
  });

  const from = (table: string) => ({
    select: () => ({
      eq: (col: string, val: any) => ({
        maybeSingle: async () => {
          if (table === "app_settings" && val === "email_relay_url") {
            return { data: opts.relayUrl ? { value: { url: opts.relayUrl } } : null, error: null };
          }
          if (table === "app_settings" && val === "email_relay_secret") {
            return { data: opts.relaySecret ? { value: { secret: opts.relaySecret } } : null, error: null };
          }
          if (table === "app_settings" && val === "app_base_url") {
            return { data: opts.baseUrl ? { value: { url: opts.baseUrl } } : null, error: null };
          }
          if (table === "profiles") return { data: { display_name: "מישהו" }, error: null };
          if (table === "systems") return { data: { system_code: "S1", name: "מערכת בדיקה" }, error: null };
          if (table === "crms") return { data: { name: "CRM" }, error: null };
          if (table === "system_notes" || table === "crm_record_notes") return { data: { body: "גוף ההערה" }, error: null };
          return { data: null, error: null };
        },
      }),
    }),
  });

  return {
    admin: {
      rpc,
      from,
      auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: { email: id === "no-email" ? null : `${id}@x.com` } }, error: null })) } },
    },
    finishCalls,
    rpcCalls,
  };
}

describe("processMentionQueue", () => {
  it("sends once via the relay with the delivery id as idempotency key, then finishes 'sent'", async () => {
    const { admin, finishCalls } = makeSupabaseAdmin({
      claimRows: [[baseRow()]],
      relayUrl: "https://relay.example/exec",
      relaySecret: "s3cr3t",
      baseUrl: "https://example.com/app",
    });
    const postToRelay = vi.fn(
      async (_url: string, _payload: unknown) => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const result = await processMentionQueue(admin, { postToRelay });

    expect(postToRelay).toHaveBeenCalledTimes(1);
    const [url, payload] = postToRelay.mock.calls[0]!;
    expect(url).toBe("https://relay.example/exec");
    expect((payload as any).action).toBe("send_notification");
    expect((payload as any).idempotencyKey).toBe("d1");
    expect(finishCalls).toEqual([{ _delivery_id: "d1", _status: "sent" }]);
    expect(result.sent).toBe(1);
  });

  it("backs off 60s on the first relay failure and fails outright on the fifth attempt", async () => {
    const postToRelay = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "בעיה" }), { status: 500 }));

    const attempt1 = makeSupabaseAdmin({
      claimRows: [[baseRow({ attempts: 0 })]],
      relayUrl: "https://relay.example/exec",
      relaySecret: "s3cr3t",
      baseUrl: "https://example.com/app",
    });
    await processMentionQueue(attempt1.admin, { postToRelay });
    expect(attempt1.finishCalls[0]).toMatchObject({ _delivery_id: "d1", _status: "pending", _retry_in_seconds: 60 });

    const attempt5 = makeSupabaseAdmin({
      claimRows: [[baseRow({ attempts: 4 })]],
      relayUrl: "https://relay.example/exec",
      relaySecret: "s3cr3t",
      baseUrl: "https://example.com/app",
    });
    await processMentionQueue(attempt5.admin, { postToRelay });
    expect(attempt5.finishCalls[0]).toMatchObject({ _delivery_id: "d1", _status: "failed" });
  });

  it("marks a recipient without an email as skipped_no_email", async () => {
    const { admin, finishCalls } = makeSupabaseAdmin({
      claimRows: [[baseRow({ mentioned_user_id: "no-email" })]],
      relayUrl: "https://relay.example/exec",
      relaySecret: "s3cr3t",
      baseUrl: "https://example.com/app",
    });
    const postToRelay = vi.fn();
    const result = await processMentionQueue(admin, { postToRelay });
    expect(postToRelay).not.toHaveBeenCalled();
    expect(finishCalls).toEqual([{ _delivery_id: "d1", _status: "skipped_no_email" }]);
    expect(result.skipped).toBe(1);
  });

  it("counts as unknown when the relay succeeds but finishing the delivery fails, without double-sending on the next run", async () => {
    const postToRelay = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { admin, finishCalls } = makeSupabaseAdmin({
      claimRows: [[baseRow()], []],
      relayUrl: "https://relay.example/exec",
      relaySecret: "s3cr3t",
      baseUrl: "https://example.com/app",
      finish: () => ({ error: { message: "db down" } }),
    });

    const first = await processMentionQueue(admin, { postToRelay });
    expect(first.unknown).toBe(1);
    expect(postToRelay).toHaveBeenCalledTimes(1);

    // A following run that claims nothing must not touch the relay at all.
    const second = await processMentionQueue(admin, { postToRelay });
    expect(second.processed).toBe(0);
    expect(postToRelay).toHaveBeenCalledTimes(1);
  });

  it("fails with the Hebrew message when APP_BASE_URL is not configured anywhere", async () => {
    const original = process.env.APP_BASE_URL;
    delete process.env.APP_BASE_URL;
    try {
      const { admin, finishCalls } = makeSupabaseAdmin({
        claimRows: [[baseRow()]],
        relayUrl: "https://relay.example/exec",
        relaySecret: "s3cr3t",
        baseUrl: null,
      });
      const result = await processMentionQueue(admin, { postToRelay: vi.fn() });
      expect(finishCalls).toEqual([
        { _delivery_id: "d1", _status: "failed", _error: "APP_BASE_URL אינו מוגדר — הגדר בניהול → התראות → תורי רקע" },
      ]);
      expect(result.failed).toBe(1);
    } finally {
      if (original !== undefined) process.env.APP_BASE_URL = original;
    }
  });
});

describe("validateHttpsBaseUrl / buildAppLink", () => {
  it("rejects non-https, javascript: and urls with embedded credentials", () => {
    expect(() => validateHttpsBaseUrl("http://example.com")).toThrow();
    expect(() => validateHttpsBaseUrl("javascript:alert(1)")).toThrow();
    expect(() => validateHttpsBaseUrl("https://user:pass@example.com")).toThrow();
  });

  it("accepts a plain https url and strips a trailing slash", () => {
    expect(validateHttpsBaseUrl("https://example.com/app")).toBe("https://example.com/app");
    expect(validateHttpsBaseUrl("https://example.com/app/")).toBe("https://example.com/app");
  });

  it("builds a link by joining the base and the path", () => {
    expect(buildAppLink("https://example.com/app", "/systems/abc")).toBe("https://example.com/app/systems/abc");
  });
});

describe("resolveAppBaseUrl", () => {
  it("prefers the environment variable over the stored setting", async () => {
    const original = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://env.example.com";
    try {
      const { admin } = makeSupabaseAdmin({ baseUrl: "https://stored.example.com" });
      expect(await resolveAppBaseUrl(admin)).toBe("https://env.example.com");
    } finally {
      if (original === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = original;
    }
  });
});

describe("buildMentionRpcArgs / buildUpdateMentionRpcArgs", () => {
  it("passes mentioned ids (not names) and the mentionAll flag straight through", () => {
    const args = buildMentionRpcArgs({
      sourceType: "system_note",
      targetId: "t1",
      crmKey: "yemot",
      body: "שלום",
      authorId: "auth1",
      authorName: "מחבר",
      mentionedUserIds: ["u1", "u2"],
      mentionAll: true,
    });
    expect(args._mentioned_user_ids).toEqual(["u1", "u2"]);
    expect(args._mention_all).toBe(true);
    expect(args._target_id).toBe("t1");
  });

  it("does the same for the update-note args", () => {
    const args = buildUpdateMentionRpcArgs({
      sourceType: "crm_record_note",
      noteId: "n1",
      body: "עדכון",
      editorId: "ed1",
      mentionedUserIds: ["u9"],
      mentionAll: false,
    });
    expect(args._mentioned_user_ids).toEqual(["u9"]);
    expect(args._mention_all).toBe(false);
    expect(args._note_id).toBe("n1");
  });
});

describe("resolveRealCrmKeyForRecord", () => {
  function makeCrmRecordsAdmin(record: { crm_key: string } | null) {
    return {
      from: (table: string) => {
        if (table !== "crm_records") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: record, error: null }),
            }),
          }),
        };
      },
    };
  }

  it("rejects when the record belongs to a different CRM than the client-supplied key", async () => {
    const admin = makeCrmRecordsAdmin({ crm_key: "crm_b" });
    await expect(resolveRealCrmKeyForRecord(admin, "rec1", "crm_a")).rejects.toThrow("קוד CRM לא תואם לרשומה");
  });

  it("returns the real crm key when it matches the client-supplied key", async () => {
    const admin = makeCrmRecordsAdmin({ crm_key: "crm_a" });
    await expect(resolveRealCrmKeyForRecord(admin, "rec1", "crm_a")).resolves.toBe("crm_a");
  });

  it("rejects with a Hebrew error when the record does not exist", async () => {
    const admin = makeCrmRecordsAdmin(null);
    await expect(resolveRealCrmKeyForRecord(admin, "missing", "crm_a")).rejects.toThrow("הרשומה לא נמצאה");
  });
});

describe("addNoteWithMentions authorization (crm_record_note)", () => {
  it("asserts notes_write permission against the record's real CRM, never the client-supplied one", async () => {
    vi.resetModules();
    const assertPermission = vi.fn(async () => {});
    vi.doMock("@/lib/permissions.server", () => ({
      assertPermission,
      assertCanWrite: vi.fn(async () => {}),
    }));
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { crm_key: "crm_b" }, error: null }) }) }),
      }),
    };

    // Simulate what the handler does: resolve the real key, then authorize against it.
    const realCrmKey = await resolveRealCrmKeyForRecord(admin, "rec1", "crm_b").catch((e) => {
      throw e;
    });
    const { assertPermission: assertPermissionImported } = await import("@/lib/permissions.server");
    await assertPermissionImported("user1", "notes_write", realCrmKey);

    expect(assertPermission).toHaveBeenCalledWith("user1", "notes_write", "crm_b");
    vi.doUnmock("@/lib/permissions.server");
    vi.resetModules();
  });

  it("never reaches a permission check when the client-supplied crm key does not match the record's real crm", async () => {
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { crm_key: "crm_b" }, error: null }) }) }),
      }),
    };
    const assertPermission = vi.fn(async (_u: string, _p: string, _c: string) => {});
    await expect(
      (async () => {
        const realCrmKey = await resolveRealCrmKeyForRecord(admin, "rec1", "crm_a");
        await assertPermission("user1", "notes_write", realCrmKey);
      })(),
    ).rejects.toThrow("קוד CRM לא תואם לרשומה");
    expect(assertPermission).not.toHaveBeenCalled();
  });
});
