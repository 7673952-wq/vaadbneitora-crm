// Pure, client-safe system-name matching helpers.
//
// Extracted from YemotCreateModal so the SAME logic drives both the "new
// system" modal and the requests screen's system-name matching. No I/O here:
// callers load the candidate rows (already-fetched search results) and hand
// them to these functions.

export type SystemLite = {
  id: string;
  name: string;
  system_code?: string | null;
  parent_system_id?: string | null;
  parent?: { id: string; name: string; system_code?: string | null; parent_system_id?: string | null } | null;
};

/** Names that always offer the "open as sub / open as new root" choice, even
 * when no matching root exists yet in the DB (the root is created on demand). */
export const CATEGORY_NAMES = ["קו ההגנה"];

export const VIRTUAL_PARENT_ID = "__virtual_category_root__";

export function normalizeSystemName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isCategoryName(s: string | null | undefined): boolean {
  return CATEGORY_NAMES.some((c) => normalizeSystemName(c) === normalizeSystemName(s));
}

function isValidParent(p: any): boolean {
  return !!p && typeof p.id === "string" && p.id.trim()
    && typeof p.name === "string" && p.name.trim();
}

/** Walks up parent links (up to 10 hops) to the true root system. */
export function resolveRootSystem(row: SystemLite, byId: Map<string, SystemLite>): SystemLite | null {
  let node: SystemLite | null = row;
  for (let hop = 0; hop < 10 && node; hop++) {
    if (!node.parent_system_id) return node;
    const next = byId.get(node.parent_system_id) ?? node.parent ?? null;
    if (!next || next.id === node.id) return node;
    node = next as SystemLite;
  }
  return node;
}

export type MatchOption = { id: string; system_code: string; name: string };

export type NameMatchResult = {
  /** Rows whose normalized name exactly equals the typed name. */
  exactMatches: SystemLite[];
  /** Root candidates the user may attach a new sub-system to. */
  parentOptions: MatchOption[];
  /** True when the typed name is a known category with no match yet — the
   * caller should offer to create/attach to a virtual category root. */
  isVirtualCategory: boolean;
};

/**
 * Computes the match result for a typed system name against already-loaded
 * candidate rows (e.g. the result of a name search). Pure — does no lookups.
 */
export function computeNameMatch(typedName: string, rows: SystemLite[]): NameMatchResult {
  const target = normalizeSystemName(typedName);
  const exactMatches = (rows ?? []).filter((r) => normalizeSystemName(r.name) === target);

  const byId = new Map<string, SystemLite>();
  for (const r of rows ?? []) {
    byId.set(r.id, r);
    if (r.parent && r.parent.id) byId.set(r.parent.id, r.parent as SystemLite);
  }

  const optsMap = new Map<string, MatchOption>();
  for (const r of exactMatches) {
    const root = resolveRootSystem(r, byId);
    if (isValidParent(root)) {
      optsMap.set((root as SystemLite).id, {
        id: (root as SystemLite).id,
        system_code: (root as SystemLite).system_code ?? "",
        name: (root as SystemLite).name,
      });
    }
  }
  const parentOptions = Array.from(optsMap.values());

  return {
    exactMatches,
    parentOptions,
    isVirtualCategory: parentOptions.length === 0 && isCategoryName(typedName),
  };
}

/** The virtual category root option to show when `isVirtualCategory` is true. */
export function virtualCategoryOption(typedName: string): MatchOption {
  return { id: VIRTUAL_PARENT_ID, name: typedName.trim(), system_code: "" };
}

// ---------------------------------------------------------------------------
// Root-confirmation snapshot logic (used by the requests flow, task D).
// ---------------------------------------------------------------------------

export type ConfirmedMatch = { id: string; name: string; system_code?: string | null };

export type RootCreationDecision =
  | { outcome: "create" }
  | { outcome: "conflict"; matches: ConfirmedMatch[] };

/**
 * Server-side rule for confirming a "create a NEW root anyway" decision:
 *  - no snapshot and a match now exists           → conflict
 *  - snapshot exists, current matches ⊆ snapshot   → create
 *  - a match id appears that is NOT in the snapshot → conflict
 * Never trusts a bare client boolean — always re-evaluates against the
 * current matches passed in by the caller (freshly queried).
 */
export function decideRootCreation(
  currentMatches: ConfirmedMatch[],
  snapshot: ConfirmedMatch[] | null | undefined,
): RootCreationDecision {
  if (!currentMatches.length) return { outcome: "create" };
  if (!snapshot || !snapshot.length) return { outcome: "conflict", matches: currentMatches };
  const snapshotIds = new Set(snapshot.map((m) => m.id));
  const isSubset = currentMatches.every((m) => snapshotIds.has(m.id));
  if (isSubset) return { outcome: "create" };
  return { outcome: "conflict", matches: currentMatches };
}
