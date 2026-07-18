import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { LayoutDashboard, Users, LogOut, BarChart3, TrendingUp, Database, KeyRound, X } from "lucide-react";
import { toast } from "sonner";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { NotificationBell } from "@/components/NotificationBell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => (
    <GlobalErrorBoundary>
      <AuthedLayout />
    </GlobalErrorBoundary>
  ),
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
    staleTime: 5 * 60_000,
  });
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [displayName, setDisplayName] = useState<string>("");
  const [pwOpen, setPwOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  function getInitials(name: string): string {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  async function changePassword() {
    if (pw1.length < 6) { toast.error("הסיסמה חייבת לכלול לפחות 6 תווים"); return; }
    if (pw1 !== pw2) { toast.error("הסיסמאות אינן תואמות"); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setPwBusy(false);
    if (error) { toast.error(error.message || "שינוי הסיסמה נכשל"); return; }
    toast.success("הסיסמה עודכנה בהצלחה");
    setPw1(""); setPw2(""); setPwOpen(false);
  }

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        setSessionReady(false);
        navigate({ to: "/auth", replace: true });
        return;
      }
      if (session) setSessionReady(true);
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
    ...(me?.isAdmin ? [
      { to: "/manager-dashboard", label: "דשבורד מנהלים", icon: TrendingUp },
    ] : []),
    ...(me?.isSuperAdmin ? [
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
          <div className="mr-auto flex items-center gap-2 relative">
            {sessionReady && <NotificationBell />}
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition"
              title={displayName}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                {getInitials(displayName)}
              </span>
              <span className="text-sm text-right hidden sm:block">
                <div className="font-medium">{displayName}</div>
                <div className="text-xs text-muted-foreground">{me?.isSuperAdmin ? "מנהל ראשי" : me?.isAdmin ? "מנהל" : me?.isAgent ? "נציג" : me?.isViewer ? "צופה" : ""}</div>
              </span>
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-lg border border-border bg-popover shadow-lg py-1">
                  <button
                    onClick={() => { setUserMenuOpen(false); setPwOpen(true); }}
                    className="w-full flex items-center gap-2 text-sm px-3 py-2 text-right hover:bg-accent"
                  >
                    <KeyRound className="h-4 w-4" />
                    שנה סיסמה
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2 text-sm px-3 py-2 text-right hover:bg-accent"
                  >
                    <LogOut className="h-4 w-4" />
                    יציאה
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <Outlet />
      </main>

      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !pwBusy && setPwOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-background border border-border shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">שינוי סיסמה</h2>
              <button onClick={() => !pwBusy && setPwOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium block mb-1">סיסמה חדשה</label>
                <input type="password" autoFocus value={pw1} onChange={(e) => setPw1(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="מינ׳ 6 תווים" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">אישור סיסמה</label>
                <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") changePassword(); }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="הקלד שוב" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={changePassword} disabled={pwBusy}
                  className="flex-1 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                  {pwBusy ? "מעדכן..." : "עדכן סיסמה"}
                </button>
                <button onClick={() => setPwOpen(false)} disabled={pwBusy}
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">
                  ביטול
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
