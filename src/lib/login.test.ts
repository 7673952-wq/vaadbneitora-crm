import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { throttleOtpSend, noteOtpSend, throttleLogin, noteLoginFailure } from "@/lib/login.server";

/** Minimal stand-in for the admin client used by the throttle helpers. */
function fakeAdmin(row: { hits: number; updated_at: string } | null) {
  const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
  const client = {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
      }),
    }),
  };
  return { client, rpc };
}

describe("OTP send throttle", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-01-01T12:00:00Z")));
  afterEach(() => vi.useRealTimers());

  it("allows the first send", async () => {
    const { client } = fakeAdmin(null);
    await expect(throttleOtpSend(client, "u1")).resolves.toBeUndefined();
  });

  it("blocks a second send inside the 30 second cooldown", async () => {
    const { client } = fakeAdmin({ hits: 1, updated_at: new Date(Date.now() - 5_000).toISOString() });
    await expect(throttleOtpSend(client, "u1")).rejects.toThrow(/כמה שניות/);
  });

  it("allows another send once the cooldown passed", async () => {
    const { client } = fakeAdmin({ hits: 2, updated_at: new Date(Date.now() - 45_000).toISOString() });
    await expect(throttleOtpSend(client, "u1")).resolves.toBeUndefined();
  });

  it("blocks past the per-window ceiling even after the cooldown", async () => {
    const { client } = fakeAdmin({ hits: 5, updated_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    await expect(throttleOtpSend(client, "u1")).rejects.toThrow(/יותר מדי/);
  });

  it("counts a send through the shared rate-limit bucket", async () => {
    const { client, rpc } = fakeAdmin(null);
    await noteOtpSend(client, "u1");
    expect(rpc).toHaveBeenCalledWith("bump_rate_limit", expect.objectContaining({ _key: "otp_send:u1" }));
  });
});

// Supabase reports failures as an `error` object rather than throwing, so a
// broken counter must not read as "no attempts so far".
function brokenAdmin(message: string) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message } }) }),
        }),
      }),
    }),
  } as any;
}

describe("throttling fails closed when the counter is unavailable", () => {
  it("refuses an OTP send when the read fails", async () => {
    await expect(throttleOtpSend(brokenAdmin("timeout"), "u1")).rejects.toThrow(/אינה זמינה/);
  });

  it("refuses to record an OTP send when the counter errors", async () => {
    await expect(noteOtpSend(brokenAdmin("timeout"), "u1")).rejects.toThrow(/אינה זמינה/);
  });

  it("refuses a login attempt when the failure count cannot be read", async () => {
    await expect(throttleLogin(brokenAdmin("timeout"), "a@b.c")).rejects.toThrow(/אינה זמינה/);
  });

  it("refuses to swallow a failed login-failure record", async () => {
    await expect(noteLoginFailure(brokenAdmin("timeout"), "a@b.c")).rejects.toThrow(/אינה זמינה/);
  });
});
