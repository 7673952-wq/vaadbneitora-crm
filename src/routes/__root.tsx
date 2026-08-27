import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { applyStatusSettings, markStatusSettingsHydrated, writeStatusCache } from "@/lib/status";
import { listStatusSettings } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { Toaster } from "sonner";
import { getDeviceId, describeDevice } from "@/lib/device-id";
import { recordLoginEvent } from "@/lib/login.functions";
import { perfMark } from "@/lib/perf";
import { useSession } from "@/lib/use-session";
import { clearAccessToken, primeAccessToken } from "@/lib/session-cache";
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
    // Session lifetime is decided by WHERE the session is stored at login:
    //   remembered     -> localStorage, survives closing the browser
    //   not remembered -> sessionStorage, dies with the browser session
    // No startup "force sign-out" heuristic and no tab-presence channel: both
    // used to sign remembered users out on a missed ping.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      primeAccessToken(session ?? null);
      if (event === "SIGNED_IN") {
        // A fresh password login is journaled by the auth page itself.
        sessionStorage.setItem(LOGIN_LOGGED, "1");
      }
      if (event === "SIGNED_OUT") {
        sessionStorage.removeItem(LOGIN_LOGGED);
        clearAccessToken();
        queryClient.clear();
      }
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") {
        queryClient.invalidateQueries({ queryKey: ["me"] });
        queryClient.invalidateQueries({ queryKey: ["my_email_profile"] });
      }
    });
    return () => { subscription.unsubscribe(); };
  }, [router, queryClient]);

  useEffect(() => { perfMark("APP_START"); }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusSettingsHydrator />
      <SessionJournal />
      <Outlet />
      <Toaster position="top-center" richColors dir="rtl" />
      <PerfOverlay />
    </QueryClientProvider>
  );

}

const LOGIN_LOGGED = "crm_login_logged";

/**
 * Journals "session" entries (a sign-in that needed no password) once per tab.
 * Reads the shared session cache instead of calling getSession() again.
 */
function SessionJournal() {
  const { session } = useSession();
  useEffect(() => {
    if (!session) return;
    if (sessionStorage.getItem(LOGIN_LOGGED)) return;
    sessionStorage.setItem(LOGIN_LOGGED, "1");
    void recordLoginEvent({
      data: { kind: "session", device_id: getDeviceId(), user_agent: describeDevice() },
    }).catch(() => { /* journaling must never block the app */ });
  }, [session]);
  return null;
}


function StatusSettingsHydrator() {
  const fn = useServerFn(listStatusSettings);
  // One shared session source (useSession) instead of a second auth listener
  // and a second getSession() call on every page load.
  const { session } = useSession();
  // The versioned cache is applied at module load inside @/lib/status, so the
  // very first paint already shows the admin's real statuses.
  const { data } = useQuery({
    queryKey: ["status_settings"],
    queryFn: async () => {
      perfMark("STATUS_SETTINGS_START");
      const res = await fn({});
      perfMark("STATUS_SETTINGS_READY");
      return res;
    },
    enabled: !!session,
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

