import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid the spinner on every dashboard switch / focus change.
        // Server data stays fresh enough for ~30s; mutations still
        // invalidate explicitly so the UI is never stale after a write.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });

  // Reference data ("who am I", agents, status settings, permissions) is read
  // by many screens with slightly different staleTime values. Since the cache
  // is keyed by queryKey alone, the shortest staleTime used to win and every
  // navigation refetched the same rows. Pinning defaults per key keeps a
  // single fetch per session-ish window regardless of the call site.
  const REFERENCE_STALE = 5 * 60_000;
  for (const key of ["me", "agents", "status_settings", "permission_settings", "crms"]) {
    queryClient.setQueryDefaults([key], {
      staleTime: REFERENCE_STALE,
      gcTime: 30 * 60_000,
      refetchOnMount: false,
    });
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};

