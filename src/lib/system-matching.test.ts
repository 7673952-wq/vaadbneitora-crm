import { describe, it, expect } from "vitest";
import {
  normalizeSystemName, isCategoryName, resolveRootSystem, computeNameMatch,
  virtualCategoryOption, decideRootCreation, VIRTUAL_PARENT_ID, CATEGORY_NAMES,
  type SystemLite, type ConfirmedMatch,
} from "./system-matching";

describe("normalizeSystemName", () => {
  it("trims and lower-cases", () => {
    expect(normalizeSystemName("  Abc  ")).toBe("abc");
  });

  it("collapses internal runs of whitespace to a single space", () => {
    expect(normalizeSystemName("קו   ההגנה")).toBe(normalizeSystemName("קו ההגנה"));
    expect(normalizeSystemName("a\tb\n c")).toBe("a b c");
  });

  it("treats null/undefined as an empty string", () => {
    expect(normalizeSystemName(null)).toBe("");
    expect(normalizeSystemName(undefined)).toBe("");
  });

  it("does NOT strip punctuation — a literal difference stays a difference", () => {
    expect(normalizeSystemName("א.ב.ג")).not.toBe(normalizeSystemName("אבג"));
  });

  it("does NOT fold straight and curly quotes together (documents current behavior)", () => {
    // Hebrew geresh (') and gershayim (") are common in acronyms/abbreviations;
    // normalizeSystemName only trims/lower-cases/collapses spaces, it never
    // maps between quote variants, so these differ unless byte-identical.
    const straight = normalizeSystemName(`צה"ל`);
    const gershayim = normalizeSystemName(`צה\u05F4ל`); // HEBREW PUNCTUATION GERSHAYIM
    const geresh = normalizeSystemName(`אבג\u05F3`); // HEBREW PUNCTUATION GERESH
    expect(straight).toBe(`צה"ל`);
    expect(gershayim).toBe(`צה\u05F4ל`);
    expect(straight).not.toBe(gershayim);
    expect(geresh).toBe(`אבג\u05F3`);
  });

  it("is otherwise identity-preserving on identical strings regardless of case", () => {
    expect(normalizeSystemName("ABC")).toBe(normalizeSystemName("abc"));
  });
});

describe("isCategoryName", () => {
  it("matches a configured category name exactly (normalized)", () => {
    expect(isCategoryName("קו ההגנה")).toBe(true);
    expect(isCategoryName("  קו   ההגנה  ")).toBe(true);
    expect(isCategoryName("קו ההגנה 2")).toBe(false);
  });

  it("is case-insensitive for latin category-like input", () => {
    expect(isCategoryName(CATEGORY_NAMES[0]!.toUpperCase())).toBe(true);
  });

  it("returns false for an unrelated name", () => {
    expect(isCategoryName("מערכת רגילה")).toBe(false);
    expect(isCategoryName(null)).toBe(false);
  });
});

describe("resolveRootSystem", () => {
  it("returns the row itself when it has no parent", () => {
    const row: SystemLite = { id: "s1", name: "Root" };
    expect(resolveRootSystem(row, new Map())).toBe(row);
  });

  it("walks up through the byId map to the true root", () => {
    const root: SystemLite = { id: "root", name: "Root" };
    const mid: SystemLite = { id: "mid", name: "Mid", parent_system_id: "root" };
    const leaf: SystemLite = { id: "leaf", name: "Leaf", parent_system_id: "mid" };
    const byId = new Map([["root", root], ["mid", mid], ["leaf", leaf]]);
    expect(resolveRootSystem(leaf, byId)).toBe(root);
  });

  it("falls back to the row's embedded `parent` when the map lacks the id", () => {
    const parent = { id: "p1", name: "Parent" };
    const row: SystemLite = { id: "s1", name: "Sub", parent_system_id: "p1", parent };
    expect(resolveRootSystem(row, new Map())).toBe(parent);
  });

  it("stops instead of looping forever on a self-referencing row", () => {
    const row: SystemLite = { id: "s1", name: "Loop", parent_system_id: "s1" };
    const byId = new Map([["s1", row]]);
    expect(resolveRootSystem(row, byId)).toBe(row);
  });

  it("stops after 10 hops even on a cycle that never resolves to itself directly", () => {
    // Build a 12-node chain that cycles back to node 0, to prove the walk
    // terminates instead of looping forever.
    const nodes: SystemLite[] = [];
    for (let i = 0; i < 12; i++) nodes.push({ id: `n${i}`, name: `n${i}` });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (let i = 0; i < 12; i++) nodes[i]!.parent_system_id = nodes[(i + 1) % 12]!.id;
    const result = resolveRootSystem(nodes[0]!, byId);
    expect(result).toBeTruthy(); // terminates — does not hang the test
  });

  it("stops at a missing parent id (dangling reference)", () => {
    const row: SystemLite = { id: "s1", name: "Sub", parent_system_id: "ghost" };
    expect(resolveRootSystem(row, new Map())).toBe(row);
  });
});

describe("computeNameMatch — sub vs root resolution", () => {
  const root: SystemLite = { id: "root-1", name: "מערכת אבטחה", system_code: "111" };
  const sub: SystemLite = {
    id: "sub-1", name: "יעד", system_code: "222",
    parent_system_id: "root-1", parent: { id: "root-1", name: "מערכת אבטחה", system_code: "111" },
  };

  it("an exact match on a ROOT row offers that root itself as the parent option", () => {
    const res = computeNameMatch("מערכת אבטחה", [root]);
    expect(res.exactMatches).toEqual([root]);
    expect(res.parentOptions).toEqual([{ id: "root-1", system_code: "111", name: "מערכת אבטחה" }]);
  });

  it("an exact match on a SUB row resolves and offers its ROOT as the parent option", () => {
    const res = computeNameMatch("יעד", [sub]);
    expect(res.exactMatches).toEqual([sub]);
    expect(res.parentOptions).toEqual([{ id: "root-1", system_code: "111", name: "מערכת אבטחה" }]);
  });

  it("de-duplicates parent options when several subs share the same root", () => {
    const sub2: SystemLite = { ...sub, id: "sub-2" };
    const res = computeNameMatch("יעד", [sub, sub2]);
    expect(res.parentOptions).toHaveLength(1);
  });

  it("ignores rows with no usable id/name when computing parent options", () => {
    const badRoot: SystemLite = { id: "", name: "" };
    const badSub: SystemLite = { id: "sub-x", name: "יעד", parent_system_id: "", parent: badRoot as any };
    const res = computeNameMatch("יעד", [badSub]);
    expect(res.parentOptions).toEqual([]);
  });

  it("matching is case/space-insensitive via normalizeSystemName", () => {
    const res = computeNameMatch("  מערכת   אבטחה ", [root]);
    expect(res.exactMatches).toEqual([root]);
  });

  it("returns no matches for an unrelated typed name", () => {
    const res = computeNameMatch("שם אחר לגמרי", [root, sub]);
    expect(res.exactMatches).toEqual([]);
    expect(res.parentOptions).toEqual([]);
  });
});

describe("computeNameMatch — category virtual roots", () => {
  it("flags isVirtualCategory when the typed name is a known category with no existing match", () => {
    const res = computeNameMatch(CATEGORY_NAMES[0]!, []);
    expect(res.exactMatches).toEqual([]);
    expect(res.parentOptions).toEqual([]);
    expect(res.isVirtualCategory).toBe(true);
  });

  it("does NOT flag isVirtualCategory once a real root already matches the category name", () => {
    const catRoot: SystemLite = { id: "cat-1", name: CATEGORY_NAMES[0]!, system_code: "999" };
    const res = computeNameMatch(CATEGORY_NAMES[0]!, [catRoot]);
    expect(res.parentOptions).toHaveLength(1);
    expect(res.isVirtualCategory).toBe(false);
  });

  it("does NOT flag isVirtualCategory for a non-category name with no matches", () => {
    const res = computeNameMatch("שם רגיל שלא קיים", []);
    expect(res.isVirtualCategory).toBe(false);
  });

  it("virtualCategoryOption returns the reserved virtual parent id and the typed (trimmed) name", () => {
    const opt = virtualCategoryOption("  קו ההגנה  ");
    expect(opt).toEqual({ id: VIRTUAL_PARENT_ID, name: "קו ההגנה", system_code: "" });
  });
});

describe("decideRootCreation — full state matrix", () => {
  const m1: ConfirmedMatch = { id: "m1", name: "A" };
  const m2: ConfirmedMatch = { id: "m2", name: "B" };

  it("no current matches at all → create, regardless of snapshot", () => {
    expect(decideRootCreation([], null)).toEqual({ outcome: "create" });
    expect(decideRootCreation([], [m1])).toEqual({ outcome: "create" });
  });

  it("state A: a match exists now but there is no snapshot → conflict", () => {
    expect(decideRootCreation([m1], null)).toEqual({ outcome: "conflict", matches: [m1] });
    expect(decideRootCreation([m1], undefined)).toEqual({ outcome: "conflict", matches: [m1] });
    expect(decideRootCreation([m1], [])).toEqual({ outcome: "conflict", matches: [m1] });
  });

  it("state B: current matches are fully covered by the snapshot → create", () => {
    expect(decideRootCreation([m1], [m1])).toEqual({ outcome: "create" });
    expect(decideRootCreation([m1], [m1, m2])).toEqual({ outcome: "create" });
    expect(decideRootCreation([m1, m2], [m1, m2])).toEqual({ outcome: "create" });
  });

  it("a new match outside the snapshot → conflict, reporting the CURRENT matches", () => {
    expect(decideRootCreation([m1, m2], [m1])).toEqual({ outcome: "conflict", matches: [m1, m2] });
  });

  it("never trusts identity alone — matches by id, not by object reference or name", () => {
    const snapshotCopy: ConfirmedMatch = { id: "m1", name: "renamed since" };
    expect(decideRootCreation([m1], [snapshotCopy])).toEqual({ outcome: "create" });
  });
});
