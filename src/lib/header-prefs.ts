import { useCallback, useEffect, useState } from "react";

/** Which optional header items the user wants to see in the top bar. */
export type HeaderPrefs = {
  search: boolean;
  newRecord: boolean;
  kosher: boolean;
  bell: boolean;
  avatarName: boolean;
};

export const HEADER_PREF_ITEMS: { key: keyof HeaderPrefs; label: string }[] = [
  { key: "search", label: "חיפוש כללי" },
  { key: "newRecord", label: "פתיחת רשומה" },
  { key: "kosher", label: "הוראות כשרות" },
  { key: "bell", label: "פעמון התראות" },
  { key: "avatarName", label: "שם משתמש ליד האווטאר" },
];

const DEFAULTS: HeaderPrefs = {
  search: true,
  newRecord: true,
  kosher: true,
  bell: true,
  avatarName: true,
};

const LS_KEY = "header_prefs_v1";

function read(): HeaderPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<HeaderPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

/** Persisted (localStorage) preferences for the top bar layout. */
export function useHeaderPrefs() {
  const [prefs, setPrefs] = useState<HeaderPrefs>(DEFAULTS);

  // Read after mount so SSR/hydration output stays identical.
  useEffect(() => setPrefs(read()), []);

  const toggle = useCallback((key: keyof HeaderPrefs) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in-memory only */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
    try {
      window.localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { prefs, toggle, reset };
}
