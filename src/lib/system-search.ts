// Single source of truth for "find candidate systems by name".
//
// Both the "open a new system" flow (findSystemByName) and the requests
// screen's name matching (matchSystemNameForRequest) MUST use this layer, so
// the same typed name can never produce two different candidate lists.
//
// Pure of I/O policy: the caller passes the Supabase client it is allowed to
// use (RLS-scoped user client, or the admin client on a verified server path).

import type { SystemLite } from "@/lib/system-matching";

export const SYSTEM_CANDIDATE_SELECT =
  "id, system_code, name, parent_system_id, parent:systems!parent_system_id(id, system_code, name, parent_system_id)";

export const EXACT_LIMIT = 50;
export const FUZZY_LIMIT = 20;

/** Same normalization on both paths: trim only (name matching lower-cases and
 * collapses whitespace afterwards in `normalizeSystemName`). */
export function normalizeSearchTerm(name: string | null | undefined): string {
  return String(name ?? "").trim();
}

/** Deduplicates merged rows by id, exact matches first. */
export function mergeCandidates(exact: any[], fuzzy: any[]): SystemLite[] {
  const seen = new Set<string>();
  const merged: SystemLite[] = [];
  for (const r of [...(exact ?? []), ...(fuzzy ?? [])]) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r as SystemLite);
  }
  return merged;
}

/**
 * Two passes so a name shared by many sub-systems never buries the true root
 * parent below the row limit: exact-name matches first, then fuzzy top-up.
 */
export async function searchCandidateSystems(client: any, name: string): Promise<SystemLite[]> {
  const term = normalizeSearchTerm(name);
  if (!term) return [];
  const [exactRes, fuzzyRes] = await Promise.all([
    client.from("systems").select(SYSTEM_CANDIDATE_SELECT).ilike("name", term).limit(EXACT_LIMIT),
    client
      .from("systems")
      .select(SYSTEM_CANDIDATE_SELECT)
      .ilike("name", `%${term}%`)
      .order("name", { ascending: true })
      .limit(FUZZY_LIMIT),
  ]);
  if (exactRes.error) throw new Error(exactRes.error.message);
  if (fuzzyRes.error) throw new Error(fuzzyRes.error.message);
  return mergeCandidates(exactRes.data ?? [], fuzzyRes.data ?? []);
}
