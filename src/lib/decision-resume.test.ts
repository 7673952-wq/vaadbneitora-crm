import { describe, it, expect } from "vitest";
import { planManualDecision } from "./system-requests.server";

// These cover the exact hazard the review named: a manual `apply` that changed
// the status and then failed halfway must NEVER come back as `keep`.
describe("planManualDecision", () => {
  it("starts a fresh decision and takes the status from the request", () => {
    const plan = planManualDecision({ proposed_status: "open" }, "apply", null);
    expect(plan).toMatchObject({ mode: "start", targetStatus: "open", statusAlreadyApplied: false });
  });

  it("prefers the explicitly chosen status on a fresh decision", () => {
    const plan = planManualDecision({ proposed_status: "open" }, "apply", "closed");
    expect(plan.mode === "start" && plan.targetStatus).toBe("closed");
  });

  it("resumes the SAME apply after a partial failure, keeping its own target", () => {
    const plan = planManualDecision(
      { manual_action: "apply", manual_target_status: "closed", status_applied_at: "2026-09-09T09:00:00Z" },
      "apply",
      // Even if the browser sends nothing, the stored intent wins.
      null,
    );
    expect(plan).toMatchObject({ mode: "resume", targetStatus: "closed", statusAlreadyApplied: true });
  });

  it("refuses a different action once one has started", () => {
    for (const action of ["keep", "ignore", "create_system"] as const) {
      const plan = planManualDecision({ manual_action: "apply", manual_target_status: "closed" }, action);
      expect(plan).toEqual({ mode: "conflict", startedAction: "apply" });
    }
  });

  it("does not treat a competing apply with another status as a new decision", () => {
    const plan = planManualDecision({ manual_action: "apply", manual_target_status: "closed" }, "apply", "open");
    expect(plan.mode === "resume" && plan.targetStatus).toBe("closed");
  });

  it("marks side effects as done so a resume never repeats them", () => {
    const plan = planManualDecision(
      { manual_action: "apply", manual_target_status: "closed", side_effects_completed_at: "2026-09-09T09:00:00Z" },
      "apply",
    );
    expect(plan.mode === "resume" && plan.sideEffectsDone).toBe(true);
  });

  it("resumes create_system on an already linked system instead of failing", () => {
    const plan = planManualDecision(
      { manual_action: "create_system", manual_target_status: "open", system_id: "sys-1" },
      "create_system",
    );
    expect(plan).toMatchObject({ mode: "resume", systemAlreadyLinked: true, targetStatus: "open" });
  });

  it("does not consider a pre-existing link part of a fresh create_system", () => {
    const plan = planManualDecision({ system_id: "sys-1", proposed_status: "open" }, "create_system");
    expect(plan.mode === "start" && plan.systemAlreadyLinked).toBe(false);
  });
});
