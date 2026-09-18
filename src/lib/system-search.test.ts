import { describe, it, expect } from "vitest";
import {
  searchCandidateSystems,
  mergeCandidates,
  normalizeSearchTerm,
  SYSTEM_CANDIDATE_SELECT,
} from "@/lib/system-search";
import { computeNameMatch } from "@/lib/system-matching";

/** Minimal fake Supabase client recording the filters each pass used. */
function fakeClient(exact: any[], fuzzy: any[], calls: any[] = []) {
  let pass = 0;
  const builder = (rows: any[], record: any) => {
    const b: any = {
      select(sel: string) { record.select = sel; return b; },
      ilike(col: string, val: string) { record.ilike = [col, val]; return b; },
      order() { record.ordered = true; return b; },
      limit(n: number) { record.limit = n; return Promise.resolve({ data: rows, error: null }); },
    };
    return b;
  };
  return {
    calls,
    from() {
      const record: any = {};
      calls.push(record);
      const rows = pass++ === 0 ? exact : fuzzy;
      return builder(rows, record);
    },
  };
}

const root = { id: "r1", name: "בית הכנסת", system_code: "100", parent_system_id: null, parent: null };
const sub = { id: "s1", name: "בית הכנסת", system_code: "101", parent_system_id: "r1", parent: root };
const partial = { id: "p1", name: "בית הכנסת הגדול", system_code: "102", parent_system_id: null, parent: null };

describe("system-search — shared candidate layer", () => {
  it("normalizes the term the same way for both screens", () => {
    expect(normalizeSearchTerm("  בית  ")).toBe("בית");
    expect(normalizeSearchTerm(null)).toBe("");
  });

  it("returns nothing for an empty name without querying", async () => {
    const c = fakeClient([], []);
    expect(await searchCandidateSystems(c, "   ")).toEqual([]);
    expect(c.calls.length).toBe(0);
  });

  it("runs an exact pass and a fuzzy pass with the same projection", async () => {
    const c = fakeClient([root, sub], [partial]);
    const rows = await searchCandidateSystems(c, "בית הכנסת");
    expect(c.calls[0].select).toBe(SYSTEM_CANDIDATE_SELECT);
    expect(c.calls[1].select).toBe(SYSTEM_CANDIDATE_SELECT);
    expect(c.calls[0].ilike).toEqual(["name", "בית הכנסת"]);
    expect(c.calls[1].ilike).toEqual(["name", "%בית הכנסת%"]);
    expect(rows.map((r) => r.id)).toEqual(["r1", "s1", "p1"]);
  });

  it("dedupes by id, exact matches first", () => {
    expect(mergeCandidates([root, sub], [sub, partial]).map((r) => r.id)).toEqual(["r1", "s1", "p1"]);
  });

  it("gives both screens identical matches for the same name", async () => {
    const newSystemScreen = await searchCandidateSystems(fakeClient([root, sub], [partial]), "בית הכנסת");
    const requestsScreen = await searchCandidateSystems(fakeClient([root, sub], [partial]), "בית הכנסת");
    expect(requestsScreen).toEqual(newSystemScreen);
    const a = computeNameMatch("בית הכנסת", newSystemScreen);
    const b = computeNameMatch("בית הכנסת", requestsScreen);
    expect(b.exactMatches.map((m) => m.id)).toEqual(a.exactMatches.map((m) => m.id));
    expect(b.parentOptions).toEqual(a.parentOptions);
  });

  it("surfaces a query error instead of returning partial results", async () => {
    const failing = {
      from: () => ({
        select: () => ({
          ilike: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "boom" } }) }),
            limit: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    };
    await expect(searchCandidateSystems(failing, "בית")).rejects.toThrow("boom");
  });
});
