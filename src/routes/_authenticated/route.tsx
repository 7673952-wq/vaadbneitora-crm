import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { LayoutDashboard, Users, LogOut, BarChart3, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const myRoleFn = useServerFn(getMyRole);
  const [sessionReady, setSessionReady] = useState(false);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => myRoleFn({ headers: await getAuthHeaders() }),
    enabled: sessionReady,
    retry: false,
    throwOnError: false,
  });
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [displayName, setDisplayName] = useState<string>("");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      setSessionReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        setSessionReady(false);
        navigate({ to: "/auth", replace: true });
        return;
      }
      setSessionReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    if (!sessionReady) return;
    supabase.auth.getUser().then(({ data }) => {
      setDisplayName((data.user?.user_metadata?.display_name as string) || data.user?.email || "");
    });
  }, [sessionReady]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/dashboard", label: "דשבורד", icon: LayoutDashboard },
    { to: "/reports", label: "דוחות", icon: BarChart3 },
    ...(me?.isAdmin ? [
      { to: "/manager-dashboard", label: "מנהלים", icon: TrendingUp },
      { to: "/admin", label: "ניהול", icon: Users },
    ] : []),
  ];

  if (!sessionReady) {
    return <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">טוען התחברות...</div>;
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center gap-6">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground font-bold flex items-center justify-center">C</div>
            <span className="font-semibold tracking-tight">CRM מערכות</span>
          </Link>
          <nav className="flex items-center gap-1 mr-4">
            {nav.map((n) => {
              const active = path.startsWith(n.to);
              return (
                <Link key={n.to} to={n.to}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}>
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="mr-auto flex items-center gap-3">
            <div className="text-sm">
              <div className="font-medium">{displayName}</div>
              <div className="text-xs text-muted-foreground">{me?.isAdmin ? "מנהל" : "נציג"}</div>
            </div>
            <button onClick={signOut} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-accent">
              <LogOut className="h-4 w-4" />
              יציאה
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
