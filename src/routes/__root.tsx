import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { applyStatusSettings, markStatusSettingsHydrated, writeStatusCache } from "@/lib/status";
import { listStatusSettings } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { useServerFn } from "@tanstack/react-start";
import { Toaster } from "sonner";
import { isRemembered } from "@/lib/device-id";
import { perfMark } from "@/lib/perf";
import { PerfOverlay } from "@/components/PerfOverlay";


function NotFoundComponent() {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">הדף לא נמצא</h2>
        <p className="mt-2 text-sm text-muted-foreground">הדף שחיפשת לא קיים או הוסר.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">משהו השתבש</h1>
        <p className="mt-2 text-sm text-muted-foreground">נסה שוב או חזור לדף הבית.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            נסה שוב
          </button>
          <a href="/" className="inline-flex rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
            דף הבית
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CRM ניהול מערכות" },
      { name: "description", content: "מערכת ניהול לקוחות ומערכות עם מעקב, היסטוריית העברות והרשאות." },
      { property: "og:title", content: "CRM ניהול מערכות" },
      { property: "og:description", content: "מערכת ניהול לקוחות ומערכות עם מעקב, היסטוריית העברות והרשאות." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "CRM ניהול מערכות" },
      { name: "twitter:description", content: "מערכת ניהול לקוחות ומערכות עם מעקב, היסטוריית העברות והרשאות." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3310efe0-49bc-42e5-b183-3f0973a16b9b/id-preview-3455b488--bee711c7-69fe-4131-9859-c15e001815c1.lovable.app-1781804335816.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3310efe0-49bc-42e5-b183-3f0973a16b9b/id-preview-3455b488--bee711c7-69fe-4131-9859-c15e001815c1.lovable.app-1781804335816.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // Force re-login on every browser/tab close: sessionStorage clears on close,
    // localStorage (where Supabase persists) does not. If we have no marker but
    // a session exists, it's a stale session from a previous tab — sign out.
    //
    // Caveat: sessionStorage is per-tab, and whether it gets copied into a
    // brand-new tab (e.g. our "פתח בלשונית נפרדת" button, or a plain
    // ctrl/cmd-click) is inconsistent across browsers, especially with
    // rel="noopener"/"noreferrer". Without a guard, a legitimate new tab of an
    // already-open session could look exactly like "stale session from a
    // closed browser" and get force-signed-out, bouncing the user to /auth.
    //
    // Instead of relying on that inconsistent sessionStorage-copy behavior, we
    // directly ask: "is another tab of this app alive right now?" via
    // BroadcastChannel (same-origin, all currently-open tabs receive it). If
    // one answers, this is a legitimate additional tab — adopt the marker
    // instead of signing out. Only sign out if truly nobody answers (i.e. this
    // is the first tab — the whole browser was closed and reopened).
    const SESSION_MARKER = "crm_active_session";
    const CHANNEL_NAME = "crm_tab_presence";
    const PING_TIMEOUT_MS = 300;

    let decided = false;
    async function resolvePresence(otherTabAlive: boolean) {
      if (decided) return;
      decided = true;
      const { data } = await supabase.auth.getSession();
      if (data.session && !sessionStorage.getItem(SESSION_MARKER)) {
        // "זכור אותי" opts this device out of the force-relogin behavior.
        if (otherTabAlive || isRemembered()) {
          sessionStorage.setItem(SESSION_MARKER, "1");
        } else {
          await supabase.auth.signOut();
        }
      }
    }


    let channel: BroadcastChannel | null = null;
    let pingTimer: ReturnType<typeof setTimeout> | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data === "ping") {
          channel?.postMessage("pong");
        } else if (event.data === "pong") {
          resolvePresence(true);
        }
      };
      channel.postMessage("ping");
      pingTimer = setTimeout(() => resolvePresence(false), PING_TIMEOUT_MS);
    } else {
      // No BroadcastChannel support — fall back to the original strict behavior.
      resolvePresence(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") sessionStorage.setItem(SESSION_MARKER, "1");
      if (event === "SIGNED_OUT") sessionStorage.removeItem(SESSION_MARKER);
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") {
        queryClient.invalidateQueries({ queryKey: ["me"] });
        queryClient.invalidateQueries({ queryKey: ["my_email_profile"] });
      }
    });
    return () => {
      subscription.unsubscribe();
      if (pingTimer) clearTimeout(pingTimer);
      channel?.close();
    };
  }, [router, queryClient]);

  useEffect(() => { perfMark("APP_START"); }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusSettingsHydrator />
      <Outlet />
      <Toaster position="top-center" richColors dir="rtl" />
      <PerfOverlay />
    </QueryClientProvider>
  );

}

function StatusSettingsHydrator() {
  const fn = useServerFn(listStatusSettings);
  const [hasSession, setHasSession] = useState(false);
  // The versioned cache is applied at module load inside @/lib/status, so the
  // very first paint already shows the admin's real statuses.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);
  const { data } = useQuery({
    queryKey: ["status_settings"],
    queryFn: async () => fn({ headers: await getAuthHeaders() }),
    enabled: hasSession,
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });
  useEffect(() => {
    if (!data) return;
    applyStatusSettings(data as any);
    markStatusSettingsHydrated();
    writeStatusCache(data as any);
  }, [data]);
  return null;
}

