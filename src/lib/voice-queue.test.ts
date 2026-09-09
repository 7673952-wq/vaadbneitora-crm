import { describe, it, expect, vi } from "vitest";
import { maybeScheduleOrSendAutoVoice } from "@/lib/systems.functions";

/**
 * A pending voice message must survive a failure. These tests drive the
 * immediate-send path with a database that fails in different ways and assert
 * the row is left in a state the queue can still pick up.
 */
function fakeAdmin(opts: {
  logError?: string;
  sendFails?: boolean;
}) {
  const updates: any[] = [];
  const client: any = {
    rpc: vi.fn(async (name: string) => {
      if (name === "bump_rate_limit") return { data: 1, error: null };
      return { data: null, error: null };
    }),
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: async () => {
          if (table === "voice_message_log" && opts.logError) {
            return { data: null, error: { message: opts.logError } };
          }
          return { data: [], error: null };
        },
        maybeSingle: async () => {
          if (table === "systems") {
            return { data: { caller_phone: "0501234567", phone: null, status: "open", additional_caller_phones: [] }, error: null };
          }
          if (table === "app_settings") return { data: { value: 0 }, error: null };
          return { data: null, error: null };
        },
        update(patch: any) {
          updates.push({ table, patch });
          const u: any = { eq: async () => ({ data: null, error: null }) };
          return u;
        },
        insert: async () => ({ data: null, error: null }),
      };
      if (table === "status_settings") {
        q.select = () => ({
          order: async () => ({
            data: [{
              status_key: "open", label: "פתוח", tone: "ok", sort_order: 1, is_custom: false,
              is_handled: false, assigned_agent_ids: [], is_mandatory: false,
              enables_voice_message: true, voice_send_mode: "auto",
              auto_send_start_hour: 0, auto_send_end_hour: 24,
            }],
            error: null,
          }),
        });
      }
      return q;
    },
  };
  return { client, updates };
}

describe("automatic voice send keeps a failed message in the queue", () => {
  it("does not clear the pending marker before the send happened", async () => {
    const { client, updates } = fakeAdmin({ logError: "db down" });
    await maybeScheduleOrSendAutoVoice(client, "sys-1", "open");
    const cleared = updates.filter((u) => u.table === "systems" && u.patch.pending_voice_send_at === null);
    expect(cleared).toHaveLength(0);
  });

  it("parks the message for a retry when the send log cannot be read", async () => {
    const { client, updates } = fakeAdmin({ logError: "db down" });
    await maybeScheduleOrSendAutoVoice(client, "sys-1", "open");
    const retry = updates.find((u) => u.table === "systems" && u.patch.voice_pending_reason === "retry");
    expect(retry).toBeTruthy();
    expect(String(retry.patch.voice_last_error)).toContain("נכשל");
    expect(retry.patch.pending_voice_send_at).toBeTruthy();
  });
});
