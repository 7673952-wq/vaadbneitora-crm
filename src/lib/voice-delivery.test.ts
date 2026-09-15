import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runYemotVoiceSend } from "@/lib/systems.functions";

// runYemotVoiceSend must be idempotent across overlapping/duplicate triggers:
// begin_voice_delivery is claimed BEFORE the provider is ever called, and
// finish_voice_delivery always records the outcome — the system row itself
// is never touched directly for "sent" bookkeeping anymore.

const SYSTEM_ROW = {
  id: "sys-1",
  system_code: "12345",
  status: "open",
  caller_phone: "0501234567",
  phone: null,
  additional_caller_phones: [],
  is_blocking_number: false,
};

const SPOKEN_CODE = SYSTEM_ROW.system_code.split("").join("!");

function jsonRes(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function textRes(text: string) {
  return { ok: true, status: 200, json: async () => { throw new Error("not json"); }, text: async () => text };
}

function providerFetchMock() {
  return vi.fn(async (url: string) => {
    if (url.includes("UpdateExtension")) return jsonRes({ responseStatus: "OK" });
    if (url.includes("GetIVR2Dir")) return jsonRes({ files: [] });
    if (url.includes("FileAction")) {
      return jsonRes({ responseStatus: "OK", success: true, target: "ivr2:0CRM/Phone/0501234567/file123.wav" });
    }
    if (url.includes("UploadTextFile")) return jsonRes({ responseStatus: "OK" });
    if (url.includes("DownloadFile")) return textRes(SPOKEN_CODE);
    if (url.includes("CallExtensionBridging")) return jsonRes({ responseStatus: "OK", CampaignId: "camp-1" });
    return jsonRes({ responseStatus: "ERROR" }, false, 500);
  });
}

type RpcScript = {
  begin?: string | Error;
  finish?: boolean;
};

function fakeAdmin(script: RpcScript) {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const systemsUpdates: any[] = [];

  const client: any = {
    rpc: vi.fn(async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      if (name === "bump_rate_limit") return { data: 1, error: null };
      if (name === "begin_voice_delivery") {
        if (script.begin instanceof Error) return { data: null, error: { message: script.begin.message } };
        return { data: script.begin ?? "proceed", error: null };
      }
      if (name === "finish_voice_delivery") {
        return { data: script.finish ?? true, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    }),
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          if (table === "systems") return { data: SYSTEM_ROW, error: null };
          if (table === "status_settings") return { data: null, error: null };
          return { data: null, error: null };
        },
        order: () => q,
        limit: async () => ({ data: [{
          status_key: "open", label: "פתוח", tone: "ok", sort_order: 1, is_custom: false,
          is_handled: false, assigned_agent_ids: [], is_mandatory: false,
          enables_voice_message: true, voice_message_template: "555",
          voice_send_mode: "auto", auto_send_start_hour: 0, auto_send_end_hour: 24,
        }], error: null }),
        insert: async () => ({ data: null, error: null }),
        update(patch: any) {
          if (table === "systems") systemsUpdates.push(patch);
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
      if (table === "status_settings") {
        q.select = () => ({
          order: async () => ({
            data: [{
              status_key: "open", label: "פתוח", tone: "ok", sort_order: 1, is_custom: false,
              is_handled: false, assigned_agent_ids: [], is_mandatory: false,
              enables_voice_message: true, voice_message_template: "555",
              voice_send_mode: "auto", auto_send_start_hour: 0, auto_send_end_hour: 24,
            }],
            error: null,
          }),
        });
      }
      return q;
    },
  };
  return { client, rpcCalls, systemsUpdates };
}

let fetchSpy: ReturnType<typeof providerFetchMock>;

beforeEach(() => {
  process.env.YEMOT_API_KEY = "test-key";
  fetchSpy = providerFetchMock();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runYemotVoiceSend idempotency", () => {
  it("begin='busy' -> provider is never called, throws voice_busy", async () => {
    const { client } = fakeAdmin({ begin: "busy" });
    await expect(runYemotVoiceSend(client, "sys-1", -1, "manual", "u1")).rejects.toMatchObject({ code: "voice_busy" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stale 'sending' resolved to 'unknown' -> provider call count stays 0, Hebrew unknown error thrown", async () => {
    const { client } = fakeAdmin({ begin: "unknown" });
    let caught: any = null;
    try {
      await runYemotVoiceSend(client, "sys-1", -1, "manual", "u1");
    } catch (e) {
      caught = e;
    }
    expect(caught?.code).toBe("voice_unknown");
    expect(String(caught?.message)).toContain("אינה ודאית");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("success -> finish('sent', campaignId) called, no direct systems sent-marker update", async () => {
    const { client, rpcCalls, systemsUpdates } = fakeAdmin({ begin: "proceed", finish: true });
    const result = await runYemotVoiceSend(client, "sys-1", -1, "manual", "u1");
    expect(result.campaignId).toBe("camp-1");

    const finishCall = rpcCalls.find((c) => c.name === "finish_voice_delivery");
    expect(finishCall).toBeTruthy();
    expect(finishCall!.args._status).toBe("sent");
    expect(finishCall!.args._campaign_id).toBe("camp-1");
    expect(finishCall!.args._error).toBeNull();

    // The old direct "mark as sent" write on the systems row must be gone —
    // finish_voice_delivery is now the sole source of truth.
    expect(systemsUpdates).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("provider failure -> finish('failed', message)", async () => {
    const { client, rpcCalls } = fakeAdmin({ begin: "proceed", finish: true });
    fetchSpy.mockImplementationOnce(async () => jsonRes({ responseStatus: "ERROR", message: "boom" }, false, 500));

    await expect(runYemotVoiceSend(client, "sys-1", -1, "manual", "u1")).rejects.toThrow();

    const finishCall = rpcCalls.find((c) => c.name === "finish_voice_delivery");
    expect(finishCall).toBeTruthy();
    expect(finishCall!.args._status).toBe("failed");
    expect(typeof finishCall!.args._error).toBe("string");
    expect(finishCall!.args._error.length).toBeGreaterThan(0);
  });

  it("begin RPC errors -> fails closed, provider never called", async () => {
    const { client } = fakeAdmin({ begin: new Error("db unreachable") });
    await expect(runYemotVoiceSend(client, "sys-1", -1, "manual", "u1")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
