// Single source of truth for loading the admin-managed status settings on the
// client. Uses the versioned localStorage cache as `initialData` so the first
// paint already shows the real statuses, and reports `ready` so screens can
// render a skeleton instead of the compiled-in defaults on a cold load.

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listStatusSettings } from "@/lib/admin.functions";
import {
  applyStatusSettings, buildStatusMaps, readStatusCache, writeStatusCache,
  markStatusSettingsHydrated, statusSettingsHydrated,
  type StatusSettingRow, type StatusMaps,
} from "@/lib/status";

export function useStatusSettings(options?: { staleTime?: number }): {
  rows: StatusSettingRow[] | undefined;
  maps: StatusMaps;
  ready: boolean;
} {
  const fn = useServerFn(listStatusSettings);
  const cached = typeof window === "undefined" ? null : readStatusCache();

  const { data } = useQuery({
    queryKey: ["status_settings"],
    queryFn: async () => fn({}),
    staleTime: options?.staleTime ?? 5 * 60_000,
    initialData: cached ?? undefined,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    applyStatusSettings(data as any);
    markStatusSettingsHydrated();
    writeStatusCache(data as any);
  }, [data]);

  const rows = (data as StatusSettingRow[] | undefined) ?? undefined;
  const maps = useMemo(() => buildStatusMaps(rows as any), [rows]);
  return {
    rows,
    maps,
    ready: !!rows || statusSettingsHydrated,
  };
}
