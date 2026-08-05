import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyRole } from "@/lib/admin.functions";
import { getMyEmailProfile, setMyEmailSignature } from "@/lib/email.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { LogOut, KeyRound, X, Mail, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { NotificationBell } from "@/components/NotificationBell";
import { CrmTabs } from "@/components/CrmTabs";
import { KosherButton } from "@/components/KosherButton";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NewRecordButton } from "@/components/NewRecordButton";
import { EmailContentEditor } from "@/components/EmailContentEditor";
import type { EmailCleanupLevel } from "@/lib/email-cleanup";



export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw redirect({ to: "/auth" });
    return { user: data.session.user };
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
  const [displayName, setDisplayName] = useState<string>("");
  const [pwOpen, setPwOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigText, setSigText] = useState("");
  const [sigBusy, setSigBusy] = useState(false);
  const [emailCleanupLevel, setEmailCleanupLevel] = useState<EmailCleanupLevel>("standard");
  const getSigFn = useServerFn(getMyEmailProfile);
  const setSigFn = useServerFn(setMyEmailSignature);
  const { data: mySig } = useQuery({
    queryKey: ["my_email_profile"],
    queryFn: async () => getSigFn({ headers: await getAuthHeaders() }),
    enabled: sigOpen,
  });
  useEffect(() => { if (mySig) setSigText(mySig.signature); }, [mySig]);
  async function saveSignature() {
    setSigBusy(true);
    try {
      const { cleanEmailContent } = await import("@/lib/email-cleanup");
      await setSigFn({ data: { signature: cleanEmailContent(sigText, emailCleanupLevel) }, headers: await getAuthHeaders() });
      toast.success("החתימה נשמרה");
      setSigOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בשמירה");
    } finally {
      setSigBusy(false);
    }
  }
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
        // Confirm before redirecting — a transient/spurious SIGNED_OUT can
        // fire (e.g. while multiple tabs coordinate token refresh) even
        // though the user is still genuinely logged in.
        supabase.auth.getSession().then(({ data: confirm }) => {
          if (!active) return;
          if (confirm.session) { setSessionReady(true); return; }
          setSessionReady(false);
          navigate({ to: "/auth", replace: true });
        });
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

  if (!sessionReady) {
    return <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">טוען התחברות...</div>;
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 px-3 pt-2.5">
        <div className="max-w-[1600px] mx-auto rounded-2xl border border-border bg-background/75 backdrop-blur-xl shadow-elevated h-14 flex items-center gap-2 px-2.5">
          {/* Logo — identity node */}
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0 rounded-xl px-2 py-1 hover:bg-accent/50 transition">
            <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground font-bold flex items-center justify-center shadow-sm">C</div>
            <span className="font-semibold tracking-tight hidden md:inline">CRM</span>
          </Link>

          {/* CRM navigation — dark command console */}
          <CrmTabs isAdmin={Boolean(me?.isSuperAdmin)} />

          {/* Spacer */}
          <div className="flex-grow" />

          {/* Global search */}
          {sessionReady && headerPrefs.search && <GlobalSearch />}

          {/* Action cluster */}
          <div className="flex items-center gap-1 shrink-0">
            {sessionReady && headerPrefs.newRecord && <NewRecordButton />}
            {sessionReady && headerPrefs.kosher && <KosherButton />}
            {sessionReady && headerPrefs.bell && <NotificationBell />}

            {/* Identity node — avatar pill */}
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-border pl-1 pr-2.5 py-1 hover:bg-accent hover:shadow-sm transition"
              title={displayName}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {getInitials(displayName)}
              </span>
              {headerPrefs.avatarName && (
                <span className="text-sm text-right hidden xl:block leading-tight">
                  <div className="font-medium">{displayName}</div>
                  <div className="text-[11px] text-muted-foreground">{me?.isSuperAdmin ? "מנהל ראשי" : me?.isAdmin ? "מנהל" : me?.isAgent ? "נציג" : me?.isViewer ? "צופה" : ""}</div>
                </span>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground hidden xl:block" />
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute left-4 top-full mt-1 z-50 w-60 rounded-lg border border-border bg-popover shadow-lg py-1">
                  <button
                    onClick={() => { setUserMenuOpen(false); setSigOpen(true); }}
                    className="w-full flex items-center gap-2 text-sm px-3 py-2 text-right hover:bg-accent"
                  >
                    <Mail className="h-4 w-4" />
                    החתימה שלי למייל
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); setPwOpen(true); }}
                    className="w-full flex items-center gap-2 text-sm px-3 py-2 text-right hover:bg-accent"
                  >
                    <KeyRound className="h-4 w-4" />
                    שנה סיסמה
                  </button>

                  <div className="my-1 border-t border-border" />
                  <div className="px-3 pt-1 pb-1 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    רכיבים בשורה העליונה
                  </div>
                  {HEADER_PREF_ITEMS.map((item) => (
                    <label
                      key={item.key}
                      className="w-full flex items-center gap-2 text-sm px-3 py-1.5 cursor-pointer hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={headerPrefs[item.key]}
                        onChange={() => toggleHeaderPref(item.key)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                  <button
                    onClick={resetHeaderPrefs}
                    className="w-full text-right px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
                  >
                    איפוס לברירת מחדל
                  </button>

                  <div className="my-1 border-t border-border" />
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

      <main className="max-w-[1600px] mx-auto px-6 py-6">
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

      {sigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !sigBusy && setSigOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-background border border-border shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">החתימה שלי למייל</h2>
              <button onClick={() => !sigBusy && setSigOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">תתווסף אוטומטית לסוף כל מייל שאתה שולח מכרטיס מערכת.</p>
              <EmailContentEditor value={sigText} onChange={setSigText} rows={5}
                placeholder={"בברכה,\nשם הנציג\nועד בני תורה"} label="חתימה"
                cleanupLevel={emailCleanupLevel} onCleanupLevelChange={setEmailCleanupLevel} />
              <div className="flex gap-2 pt-2">
                <button onClick={saveSignature} disabled={sigBusy}
                  className="flex-1 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                  {sigBusy ? "שומר..." : "שמור חתימה"}
                </button>
                <button onClick={() => setSigOpen(false)} disabled={sigBusy}
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
