import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The "open a system from a request" flow must be ONE step: the manual
// system-selection branch (link_existing / create_sub / create_root) has to
// apply the chosen status in the same decision instead of reporting success
// and then asking the user for a status again.
const SRC = readFileSync("src/lib/system-requests.functions.ts", "utf8");

function manualBranch(): string {
  const start = SRC.indexOf('if (data.action === "create_system" && data.systemAction)');
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf('} else if (data.action === "create_system")', start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("one-step system creation from a request", () => {
  const branch = manualBranch();

  it("does not return before the status is handled", () => {
    // The old shape returned `{ ok: true, systemId }` right after the system was
    // created, which forced a second click for the status.
    expect(branch).not.toContain("return { ok: true, systemId: result.systemId }");
  });

  it("takes the target status from the durable intent first", () => {
    expect(branch).toContain("intentStatus ?? data.toStatus ?? req.proposed_status");
  });

  it("validates the status before writing it", () => {
    expect(branch).toContain("assertKnownStatus(supabaseAdmin, toStatus)");
  });

  it("writes the status onto the created/linked system and proves a row changed", () => {
    expect(branch).toContain('.from("systems").update({ status: toStatus as any })');
    expect(branch).toContain("if (!statusRows?.length)");
  });

  it("records the applied status on the request itself", () => {
    expect(branch).toContain("status_applied_at");
    expect(branch).toContain("if (!markRows?.length)");
  });

  it("runs the status side effects once, guarded against a retry", () => {
    expect(branch).toContain("runSideEffectsOnce(resultSystemId, toStatus)");
    expect(SRC).toContain("if (req.side_effects_completed_at) return;");
  });

  it("marks the decision as manually applied", () => {
    expect(branch).toContain('patch.decision_status = "manual_applied"');
  });

  it("still surfaces a name conflict without touching any status", () => {
    const conflictIdx = branch.indexOf("conflict: true");
    const statusIdx = branch.indexOf("assertKnownStatus");
    expect(conflictIdx).toBeGreaterThan(-1);
    expect(conflictIdx).toBeLessThan(statusIdx);
  });
});
