import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listVoiceMessageLog } from "@/lib/admin.functions";
import { STATUS_LABEL } from "@/lib/status";
import { getAuthHeaders } from "@/lib/auth-headers";
import { Volume2, RefreshCw, Check, X } from "lucide-react";

const MODE_LABEL: Record<string, string> = { manual: "ידני", auto: "אוטומטי", queue: "מהתור" };

// Shared "יומן הודעות קוליות" table — every send attempt (manual, auto, or
// queue), including whether it succeeded and what the system's status was
// at the time it was sent. Used both in the admin settings tab and as a
// standalone modal from the managers' dashboard.
export function VoiceMessageLogPanel() {
  const listFn = useServerFn(listVoiceMessageLog);
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["voice_message_log"],
    queryFn: async () => listFn({ headers: await getAuthHeaders() }),
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="text-center py-10 text-muted-foreground">טוען יומן הודעות...</div>;

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-card border border-border p-5 rounded-xl shadow-sm">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-primary" />
            יומן הודעות קוליות ({rows.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            כל ניסיון שליחה (ידני, אוטומטי או מהתור) - כולל הצלחות, כשלונות והסטטוס של המערכת בזמן השליחה. ממויין מהחדש לישן.
          </p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent transition-colors">
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          רענן
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr className="text-right">
              <th className="px-4 py-3 font-medium text-muted-foreground">קוד מערכת</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">טלפון</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">סטטוס ההודעה שנשלחה</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">אופן שליחה</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">תוצאה</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">זמן</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground italic">אין עדיין רשומות ביומן.</td></tr>
            ) : (
              rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold">{r.system_code || "—"}</td>
                  <td className="px-4 py-3 font-mono" dir="ltr">{r.phone || "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.status_key ? (STATUS_LABEL[r.status_key as keyof typeof STATUS_LABEL] ?? r.status_key) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">{MODE_LABEL[r.send_mode] || r.send_mode}</td>
                  <td className="px-4 py-3">
                    {r.success ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
                        <Check className="h-3 w-3" />הצליח
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 uppercase" title={r.error_message || ""}>
                        <X className="h-3 w-3" />נכשל
                      </span>
                    )}
                    {!r.success && r.error_message && (
                      <div className="text-[10px] text-red-700 mt-1 max-w-xs truncate" title={r.error_message}>{r.error_message}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString("he-IL")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
