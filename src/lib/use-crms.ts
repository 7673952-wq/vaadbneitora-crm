import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyCrms, type CrmSummary } from "@/lib/crms.functions";

export type { CrmSummary };

/** CRMs the signed-in user has access to (with their per-CRM role). */
export function useMyCrms(enabled = true) {
  const fn = useServerFn(listMyCrms);
  return useQuery({
    queryKey: ["my_crms"],
    queryFn: async () => fn({}),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    throwOnError: false,
  });
}
