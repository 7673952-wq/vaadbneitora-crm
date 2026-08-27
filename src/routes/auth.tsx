import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { beginLogin, verifyLoginOtp, resendLoginOtp, recordLoginEvent, confirmMfaSession } from "@/lib/login.functions";
import { getDeviceId, setRemembered, describeDevice } from "@/lib/device-id";
import { perfMark, resetPerfTimings } from "@/lib/perf";
import { primeAccessToken } from "@/lib/session-cache";


export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "התחברות | CRM ניהול מערכות" },
      { name: "description", content: "כניסה מאובטחת למערכת ניהול ה-CRM." },
      { property: "og:title", content: "התחברות | CRM ניהול מערכות" },
      { property: "og:description", content: "כניסה מאובטחת למערכת ניהול ה-CRM." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const beginFn = useServerFn(beginLogin);
  const verifyFn = useServerFn(verifyLoginOtp);
  const resendFn = useServerFn(resendLoginOtp);
  const logFn = useServerFn(recordLoginEvent);
  const confirmFn = useServerFn(confirmMfaSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  /**
   * Creates the browser session only after every check has passed.
   * `mfaGrant` is the one-time proof handed out by verifyLoginOtp — a session
   * that only proved a password never becomes MFA-approved without it.
   */
  async function completeSignIn(mfaGrant?: string) {
    // "זכור אותי" is decided BEFORE the session is written, so the storage
    // adapter persists it in the right place from the very first write.
    setRemembered(remember);
    perfMark("SUPABASE_SIGNIN_START");
    const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { toast.error("התחברות נכשלה"); return; }
    perfMark("SUPABASE_SIGNIN_DONE");
    primeAccessToken(signedIn.session ?? null);
    // Make sure the freshly written session actually sits in the store that
    // matches "זכור אותי" — otherwise it dies when the window closes.
    await syncRememberPlacement();
    perfMark("SESSION_READY");

    if (mfaGrant) {
      perfMark("SESSION_SECURITY_START");
      try {
        await confirmFn({ data: { grant: mfaGrant } });
      } catch (err: any) {
        // A session that cannot be marked MFA-approved is useless: every
        // protected server function would reject it. Tear it down instead.
        await supabase.auth.signOut();
        toast.error(err?.message ?? "רישום האימות נכשל — התחבר מחדש");
        return;
      }
      perfMark("SESSION_SECURITY_DONE");
    }

    try {
      await logFn({
        data: { kind: "password", device_id: getDeviceId(), user_agent: describeDevice() },
      });
    } catch { /* the journal must never block a valid login */ }
    // This tab already journaled a "password" login — the root layout must not
    // add a second "session" entry for the same sign-in.
    try { sessionStorage.setItem("crm_login_logged", "1"); } catch { /* ignore */ }
    perfMark("AUTH_COMPLETE");
    toast.success("ברוך הבא");
    perfMark("NAVIGATE_START");
    navigate({ to: "/dashboard" });
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    resetPerfTimings();
    perfMark("OTP_SUBMIT_START");
    try {
      const res: any = await beginFn({ data: { email, password, device_id: getDeviceId() } });
      if (res?.mfa) {
        setChallengeId(res.challenge_id);
        setStep("otp");
        setResendCooldown(30);
        toast.success("נשלחה אליך שיחה עם קוד הכניסה");
      } else {
        await completeSignIn();
      }
    } catch (err: any) {
      toast.error(err?.message ?? "התחברות נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setLoading(true);
    try {
      const res: any = await verifyFn({ data: { challenge_id: challengeId, code, device_id: getDeviceId() } });
      perfMark("OTP_VERIFY_DONE");
      await completeSignIn(res?.mfa_grant);
    } catch (err: any) {
      toast.error(err?.message ?? "האימות נכשל");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!challengeId || resendCooldown > 0) return;
    setLoading(true);
    try {
      await resendFn({ data: { challenge_id: challengeId } });
      setCode("");
      setResendCooldown(30);
      toast.success("הקוד נשלח שוב בשיחה נוספת");
    } catch (err: any) {
      toast.error(err?.message ?? "שליחה חוזרת נכשלה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/30 to-accent/40 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-xl mb-4">C</div>
          <h1 className="text-3xl font-bold tracking-tight">CRM ניהול מערכות</h1>
          <p className="text-muted-foreground text-sm mt-2">{step === "otp" ? "הזן את קוד האימות שקיבלת בשיחה" : "התחבר כדי להמשיך"}</p>
        </div>
        {step === "credentials" ? (
          <form onSubmit={handleSignIn} className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-5">
            <div>
              <label className="text-sm font-medium block mb-2">דוא"ל</label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">סיסמה</label>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <label className="flex items-center gap-2 text-sm select-none">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-input" />
              זכור אותי במחשב/מכשיר זה
            </label>
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 font-medium hover:bg-primary/90 disabled:opacity-50 transition">
              {loading ? "מתחבר..." : "התחברות"}
            </button>
            <p className="text-xs text-center text-muted-foreground">חשבונות חדשים נוצרים על ידי מנהל המערכת</p>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-5">
            <div>
              <label className="text-sm font-medium block mb-2">קוד אימות (8 ספרות)</label>
              <Input inputMode="numeric" pattern="\d{8}" required value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-center tracking-[0.4em] text-lg outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <button type="submit" disabled={loading || code.length !== 8}
              className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 font-medium hover:bg-primary/90 disabled:opacity-50 transition">
              {loading ? "מאמת..." : "אישור"}
            </button>
            <button type="button" onClick={handleResend} disabled={loading || resendCooldown > 0}
              className="w-full rounded-lg border border-input bg-background py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 transition">
              {resendCooldown > 0 ? `שליחת קוד חוזרת בעוד ${resendCooldown} שניות` : "שלח קוד שוב"}
            </button>
            <button type="button" onClick={() => { setStep("credentials"); setCode(""); setChallengeId(null); }}
              className="w-full text-xs text-muted-foreground hover:text-foreground">
              חזרה והתחלה מחדש
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

