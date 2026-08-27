// Diagnostics overlay for the "remember me" investigation.
// Only rendered when the page is opened with ?authdebug=1 (sticky per tab).
// Shows WHERE the session is stored and what happened to it — never a token.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authStorageDiagnostics } from "@/lib/remember-storage";
import { authDebugEnabled, readAuthLog, subscribeAuthLog, logAuthEvent } from "@/lib/auth-diagnostics";

export function AuthDebugPanel() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(true);
  const [snapshot, setSnapshot] = useState<ReturnType<typeof authStorageDiagnostics>>(null);
  const [log, setLog] = useState(readAuthLog());
  const [sessionInfo, setSessionInfo] = useState<string>("בודק…");

  useEffect(() => { setEnabled(authDebugEnabled()); }, []);

  useEffect(() => {
    if (!enabled) return;
    setSnapshot(authStorageDiagnostics());
    const unsub = subscribeAuthLog(() => {
      setLog(readAuthLog());
      setSnapshot(authStorageDiagnostics());
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setSessionInfo(`שגיאה: ${error.message}`);
        logAuthEvent("getSession_error", error.message);
      } else if (!data.session) {
        setSessionInfo("אין סשן");
      } else {
        const exp = data.session.expires_at ? new Date(data.session.expires_at * 1000).toLocaleString("he-IL") : "—";
        setSessionInfo(`סשן פעיל · פג ב-${exp}`);
      }
    });
    return unsub;
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div dir="rtl" className="fixed bottom-2 left-2 z-[9999] max-h-[70vh] w-[360px] overflow-auto rounded-lg border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <strong>אבחון התחברות</strong>
        <button className="rounded px-2 py-0.5 hover:bg-accent" onClick={() => setOpen((o) => !o)}>
          {open ? "הסתר" : "הצג"}
        </button>
      </div>
      {open && (
        <div className="space-y-2">
          <div>זכור אותי: <b>{snapshot?.remembered ? "כן" : "לא"}</b></div>
          <div>{sessionInfo}</div>
          <div>
            <div className="font-semibold">localStorage</div>
            {snapshot?.local.length
              ? snapshot.local.map((k) => <div key={k.key}>{k.key} · פג {k.expiresAt ?? "—"} · refresh {k.hasRefresh ? "✓" : "✗"}</div>)
              : <div className="text-muted-foreground">ריק</div>}
          </div>
          <div>
            <div className="font-semibold">sessionStorage</div>
            {snapshot?.session.length
              ? snapshot.session.map((k) => <div key={k.key}>{k.key} · פג {k.expiresAt ?? "—"} · refresh {k.hasRefresh ? "✓" : "✗"}</div>)
              : <div className="text-muted-foreground">ריק</div>}
          </div>
          <div>גיבוי בעוגייה: <b>{snapshot?.cookieMirror ? "קיים" : "אין"}</b></div>
          <div>
            <div className="font-semibold">אירועים</div>
            {log.length
              ? log.map((e, i) => <div key={i}>{e.at} — {e.event} {e.detail ? `(${e.detail})` : ""}</div>)
              : <div className="text-muted-foreground">אין</div>}
          </div>
        </div>
      )}
    </div>
  );
}
