import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth")({
  ssr: false,
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error("התחברות נכשלה: " + error.message); return; }
    toast.success("ברוך הבא");
    navigate({ to: "/dashboard" });
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/30 to-accent/40 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-xl mb-4">C</div>
          <h1 className="text-3xl font-bold tracking-tight">CRM ניהול מערכות</h1>
          <p className="text-muted-foreground text-sm mt-2">התחבר כדי להמשיך</p>
        </div>
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
          <button type="submit" disabled={loading}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 font-medium hover:bg-primary/90 disabled:opacity-50 transition">
            {loading ? "מתחבר..." : "התחברות"}
          </button>
          <p className="text-xs text-center text-muted-foreground">חשבונות חדשים נוצרים על ידי מנהל המערכת</p>
        </form>
      </div>
    </div>
  );
}
