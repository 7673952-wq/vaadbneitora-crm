// Single shared "this name already exists — open as sub-system or as a new
// root?" picker.
//
// BOTH the "הוסף מערכת" modal (YemotCreateModal) and the requests screen use
// this hook + component, so the two screens can never drift apart: same
// candidate search (findSystemByName → searchCandidateSystems on the server),
// same matching (computeNameMatch), same virtual-category fallback, same
// markup and wording.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { findSystemByName } from "@/lib/systems.functions";
import {
  computeNameMatch, virtualCategoryOption, VIRTUAL_PARENT_ID,
} from "@/lib/system-matching";

export type ParentOption = { id: string; name: string; system_code?: string | null };

export type SystemNameMatch = {
  /** Raw candidate rows — used for the name autocomplete dropdown. */
  suggestions: any[];
  parentOptions: ParentOption[];
  matchedParent: ParentOption | null;
  setMatchedParent: (p: ParentOption | null) => void;
  createMode: "sub" | "root";
  setCreateMode: (m: "sub" | "root") => void;
  /** True while the name lookup is in flight. */
  loading: boolean;
  /** Set when the lookup itself failed — the caller MUST surface this instead
   * of silently pretending the name is free. */
  error: string | null;
  /** True when the picker has something to choose between. */
  hasMatch: boolean;
};

export function isValidParentOption(p: any): boolean {
  return !!p && typeof p.id === "string" && p.id.trim() !== ""
    && typeof p.name === "string" && p.name.trim() !== "";
}

export function useSystemNameMatch(
  name: string,
  initial?: { parent_id?: string; parent?: ParentOption; createMode?: "root" | "sub" },
  opts?: { debounceMs?: number; enabled?: boolean },
): SystemNameMatch {
  const findFn = useServerFn(findSystemByName);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [parentOptions, setParentOptions] = useState<ParentOption[]>(
    isValidParentOption(initial?.parent) ? [initial!.parent as ParentOption] : [],
  );
  const [matchedParent, setMatchedParent] = useState<ParentOption | null>(
    isValidParentOption(initial?.parent) ? (initial!.parent as ParentOption) : null,
  );
  const [createMode, setCreateMode] = useState<"sub" | "root">(
    initial?.createMode ?? (initial?.parent_id ? "sub" : "root"),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = opts?.enabled !== false;
  const debounceMs = opts?.debounceMs ?? 250;

  useEffect(() => {
    const v = (name ?? "").trim();
    if (!enabled || v.length < 2) {
      setSuggestions([]); setMatchedParent(null); setParentOptions([]);
      setLoading(false); setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await findFn({ data: { name: v } });
        if (cancelled) return;
        setError(null);
        setSuggestions(rows ?? []);
        const { parentOptions: opts2, isVirtualCategory } = computeNameMatch(v, (rows ?? []) as any);
        const initialParent = isValidParentOption(initial?.parent) ? (initial!.parent as ParentOption) : null;
        const initialPick = initial?.parent_id
          ? (opts2.find((p: any) => p.id === initial.parent_id) ?? initialParent ?? null)
          : (opts2[0] ?? null);
        setParentOptions(initial?.parent_id && initialPick ? [initialPick as ParentOption] : (opts2 as ParentOption[]));
        setMatchedParent((initialPick as ParentOption) ?? null);
        setCreateMode((current) => initial?.createMode ?? (initial?.parent_id ? "sub" : (initialPick ? current : "root")));
        // Category-name fallback: offer the sub/root choice even when no root
        // exists yet — the root is created on demand.
        if (!initialPick && isVirtualCategory) {
          const virtual = virtualCategoryOption(v) as ParentOption;
          setMatchedParent(virtual);
          setParentOptions([virtual]);
          setCreateMode((current) => initial?.createMode ?? current);
        }
      } catch (e: any) {
        if (cancelled) return;
        setSuggestions([]); setMatchedParent(null); setParentOptions([]);
        setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, findFn, enabled, debounceMs, initial?.parent_id, initial?.createMode]);

  return {
    suggestions, parentOptions, matchedParent, setMatchedParent,
    createMode, setCreateMode, loading, error,
    hasMatch: Boolean(matchedParent),
  };
}

/** The picker itself — identical in both screens. Renders nothing when the
 * typed name has no match (and no lookup error). */
export function SystemNameMatchChoice({ match, disabled }: { match: SystemNameMatch; disabled?: boolean }) {
  const { matchedParent, parentOptions, createMode, setCreateMode, setMatchedParent, error, loading } = match;

  if (error) {
    return (
      <div className="mt-2 text-xs bg-red-50 border border-red-300 text-red-900 rounded-md p-2">
        בדיקת השם נכשלה — {error}. לא ניתן לדעת אם השם קיים; נסה שוב.
      </div>
    );
  }
  if (!matchedParent) {
    return loading
      ? <p className="mt-2 text-[11px] text-muted-foreground">בודק אם השם קיים…</p>
      : null;
  }

  const isVirtual = matchedParent.id === VIRTUAL_PARENT_ID;
  return (
    <div className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2 space-y-1.5">
      <div className="font-medium">
        {isVirtual
          ? `"${matchedParent.name}" היא קטגוריה קיימת. מה לעשות?`
          : `שם זה כבר קיים כאב-מערכת (${matchedParent.system_code ?? ""}). מה לעשות?`}
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name="createMode" disabled={disabled}
          checked={createMode === "sub"} onChange={() => setCreateMode("sub")} />
        <span>פתח כתת-מערכת תחת "{matchedParent.name}"</span>
      </label>
      {createMode === "sub" && parentOptions.length > 1 && (
        <select
          value={matchedParent.id}
          disabled={disabled}
          onChange={(e) => {
            const chosen = parentOptions.find((p) => p.id === e.target.value);
            if (chosen) setMatchedParent(chosen);
          }}
          className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-xs"
        >
          {parentOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.system_code} · {p.name}</option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name="createMode" disabled={disabled}
          checked={createMode === "root"} onChange={() => setCreateMode("root")} />
        <span>פתח אב-מערכת חדשה עם אותו שם</span>
      </label>
    </div>
  );
}
