import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { assertMfaSession, MFA_REQUIRED_ERROR, MFA_CHECK_FAILED_ERROR } from "./mfa.middleware";

function client(result: { data?: unknown; error?: { message: string } | null }) {
  return { rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })) };
}

describe("assertMfaSession — a password-only session cannot reach protected data", () => {
  it("passes when the session completed the second factor", async () => {
    await expect(assertMfaSession(client({ data: true }), "u1", "s1")).resolves.toBeUndefined();
  });

  it("rejects a valid password session that never passed MFA", async () => {
    await expect(assertMfaSession(client({ data: false }), "u1", "s1")).rejects.toThrow(MFA_REQUIRED_ERROR);
  });

  it("rejects when the session id is missing from the token", async () => {
    await expect(assertMfaSession(client({ data: false }), "u1", "")).rejects.toThrow(MFA_REQUIRED_ERROR);
  });

  it("fails closed on a null/undefined answer", async () => {
    await expect(assertMfaSession(client({ data: null }), "u1", "s1")).rejects.toThrow(MFA_REQUIRED_ERROR);
    await expect(assertMfaSession(client({ data: undefined }), "u1", "s1")).rejects.toThrow(MFA_REQUIRED_ERROR);
  });

  it("fails closed when the check itself errors", async () => {
    await expect(assertMfaSession(client({ error: { message: "boom" } }), "u1", "s1"))
      .rejects.toThrow(MFA_CHECK_FAILED_ERROR);
  });

  it("scopes the check to the caller's own user and session", async () => {
    const c = client({ data: true });
    await assertMfaSession(c, "user-42", "sess-7");
    expect(c.rpc).toHaveBeenCalledWith("mfa_session_ok", { _user_id: "user-42", _session_id: "sess-7" });
  });
});

describe("every protected server-function module enforces MFA", () => {
  // login.functions.ts is deliberately exempt: its functions run BEFORE the
  // second factor exists (and confirmMfaSession is what creates the proof).
  const EXEMPT = new Set(["login.functions.ts"]);
  const dir = join(process.cwd(), "src/lib");
  const files = readdirSync(dir).filter((f) => f.endsWith(".functions.ts") && !EXEMPT.has(f));

  it("finds the server-function modules", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file} never uses bare requireSupabaseAuth`, () => {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src).not.toContain("requireSupabaseAuth");
    });
  }
});
