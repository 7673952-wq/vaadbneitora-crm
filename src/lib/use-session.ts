// Single source of truth for "who is signed in", cached under ["session"].
// Components should use this instead of calling supabase.auth.getSession()
// on their own, so a page load performs one session read, not one per widget.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const SESSION_QUERY_KEY = ["session"] as const;

export function useSession() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<Session | null> => (await supabase.auth.getSession()).data.session,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      qc.setQueryData(SESSION_QUERY_KEY, session ?? null);
    });
    return () => subscription.unsubscribe();
  }, [qc]);

  return {
    session: query.data ?? null,
    userId: query.data?.user?.id ?? null,
    ready: !query.isLoading,
  };
}
