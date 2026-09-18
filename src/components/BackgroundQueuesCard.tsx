import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getQueueStatus, setAppBaseUrl, configureQueueEndpoints, checkQueueHealth,
  listMentionDeliveries, processMentionQueueNow,
} from "@/lib/queues.functions";
import { retryMentionDelivery } from "@/lib/mentions.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ListRestart, Server } from "lucide-react";
import { queueVerdict, type QueueProbeResult } from "@/lib/queue-status";

const UNKNOWN_RETRY_WARNING =
  "לא ניתן לאשר בוודאות אם המייל כבר נשלח למשתמש זה. האם לשלוח את ההודעה שוב בכל זאת? ייתכן שהמייל כבר נשלח בעבר.";

const DELIVERY_STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "ממתין", variant: "secondary" },
  sending: { label: "בשליחה", variant: "outline" },
  sent: { label: "נשלח", variant: "default" },
  failed: { label: "נכשל", variant: "destructive" },
  skipped: { label: "אין כתובת מייל", variant: "outline" },
};

function deliveryStatusMeta(status: string) {
  return DELIVERY_STATUS_LABELS[status] ?? { label: "לא ודאי", variant: "outline" as const };
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("he-IL");
  } catch {
    return v;
  }
}

export function BackgroundQueuesCard() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getQueueStatus);
  const setBaseUrlFn = useServerFn(setAppBaseUrl);
  const configureFn = useServerFn(configureQueueEndpoints);
  const healthFn = useServerFn(checkQueueHealth);
  const deliveriesFn = useServerFn(listMentionDeliveries);
  const retryFn = useServerFn(retryMentionDelivery);
  const processFn = useServerFn(processMentionQueueNow);

  const [baseUrl, setBaseUrl] = useState("");
  const [health, setHealth] = useState<Record<string, QueueProbeResult> | null>(null);
  const [confirmRetryId, setConfirmRetryId] = useState<string | null>(null);

  const { data: statusData, isLoading: statusLoading, error: statusError } = useQuery({
    queryKey: ["queue_status"],
    queryFn: async () => statusFn({}),
  });

  const { data: deliveries, isLoading: deliveriesLoading, error: deliveriesError } = useQuery({
    queryKey: ["mention_deliveries"],
    queryFn: async () => deliveriesFn({}),
  });

  const invalidateStatus = () => qc.invalidateQueries({ queryKey: ["queue_status"] });
  const invalidateDeliveries = () => qc.invalidateQueries({ queryKey: ["mention_deliveries"] });
  const onErr = (e: any) => toast.error(e?.message ?? "שגיאה");

  const saveBaseUrlMut = useMutation({
    mutationFn: (url: string) => setBaseUrlFn({ data: { url } }),
    onSuccess: () => { toast.success("הכתובת נשמרה"); setBaseUrl(""); invalidateStatus(); },
    onError: onErr,
  });

  const configureMut = useMutation({
    mutationFn: () => configureFn({}),
    onSuccess: () => { toast.success("כתובות התור הוגדרו"); invalidateStatus(); },
    onError: onErr,
  });

  const healthMut = useMutation({
    mutationFn: () => healthFn({}),
    onSuccess: (res) => { setHealth(res); toast.success("בדיקת התקינות הסתיימה"); },
    onError: onErr,
  });

  const processMut = useMutation({
    mutationFn: () => processFn({}),
    onSuccess: () => { toast.success("תור התיוגים עובד"); invalidateStatus(); invalidateDeliveries(); },
    onError: onErr,
  });

  const retryMut = useMutation({
    mutationFn: (args: { deliveryId: string; confirmUnknown?: boolean }) =>
      retryFn({ data: args }),
    onSuccess: () => { toast.success("ההודעה תישלח שוב"); invalidateDeliveries(); invalidateStatus(); },
    onError: onErr,
  });

  if (statusError) return <div className="text-sm text-destructive">{statusError.message}</div>;

  const status = (statusData?.status ?? {}) as any;
  const envBaseUrlSet = !!statusData?.envBaseUrlSet;
  const appBaseUrl = statusData?.appBaseUrl ?? null;

  const queueRows: Array<{ key: string; name: string; info: any }> = [
    { key: "voice_queue", name: "תור הודעות קוליות", info: status.voice ?? {} },
    { key: "mention_queue", name: "תור תיוגים", info: status.mention ?? {} },
  ];

  const healthOk = health ? Object.values(health).every((h) => h.reachable) : false;
  const isReady = !!appBaseUrl && healthOk;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Server className="h-4 w-4" />תורי רקע (הודעות קוליות ותיוגים)</h2>
        <p className="text-sm text-muted-foreground mt-1">ניהול תורי העיבוד ברקע ששולחים הודעות קוליות ותיוגי משתמשים.</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">תור</TableHead>
              <TableHead className="text-right">כתובת (URL)</TableHead>
              <TableHead className="text-right">מופעל/כבוי</TableHead>
              <TableHead className="text-right">ממתינים</TableHead>
              <TableHead className="text-right">אסימון מוגדר</TableHead>
              <TableHead className="text-right">עודכן</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statusLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">טוען...</TableCell></TableRow>
            )}
            {!statusLoading && queueRows.map((q) => (
              <TableRow key={q.key}>
                <TableCell className="font-medium">{q.name}</TableCell>
                <TableCell className="max-w-xs truncate">{q.info?.url ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={q.info?.armed ? "default" : "outline"}>{q.info?.armed ? "מופעל" : "כבוי"}</Badge>
                </TableCell>
                <TableCell>{q.info?.pending ?? 0}</TableCell>
                <TableCell>
                  <Badge variant={q.info?.token_configured ? "default" : "destructive"}>
                    {q.info?.token_configured ? "כן" : "לא"}
                  </Badge>
                </TableCell>
                <TableCell>{fmtDate(q.info?.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">כתובת בסיס לאתר (APP_BASE_URL)</label>
          <Input
            dir="ltr"
            placeholder={appBaseUrl ?? "https://example.com"}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={envBaseUrlSet}
          />
        </div>
        <Button
          onClick={() => saveBaseUrlMut.mutate(baseUrl.trim())}
          disabled={envBaseUrlSet || !baseUrl.trim() || saveBaseUrlMut.isPending}
        >
          שמור כתובת
        </Button>
      </div>
      {envBaseUrlSet && (
        <p className="text-xs text-muted-foreground">
          משתנה הסביבה APP_BASE_URL כבר מוגדר בשרת, ולכן אינו ניתן לעריכה כאן.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => configureMut.mutate()} disabled={configureMut.isPending}>
          הגדר כתובות תור
        </Button>
        <Button variant="outline" onClick={() => healthMut.mutate()} disabled={healthMut.isPending}>
          בדיקת תקינות
        </Button>
        <Button variant="outline" onClick={() => processMut.mutate()} disabled={processMut.isPending}>
          עבד תור תיוגים עכשיו
        </Button>
      </div>

      {health && (
        <div className="space-y-2 text-sm">
          {queueRows.map((q) => {
            const h = health[q.key];
            if (!h) return null;
            const verdict = queueVerdict(h);
            return (
              <div key={q.key} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{q.name}:</span>
                <Badge variant={verdict.ok ? "default" : "destructive"}>{verdict.ok ? "תקין" : "לא תקין"}</Badge>
                {!verdict.ok && <span className="text-muted-foreground">{verdict.message}</span>}
                <Badge variant={h.armed ? "default" : "outline"}>{h.armed ? "מופעל" : "כבוי"}</Badge>
                <span className="text-muted-foreground">ממתינים: {h.pending}</span>
              </div>
            );
          })}

        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">שליחות תיוגים אחרונות</h3>
        {deliveriesError && <div className="text-sm text-destructive">{deliveriesError.message}</div>}
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">תויג</TableHead>
                <TableHead className="text-right">על ידי</TableHead>
                <TableHead className="text-right">רשומה</TableHead>
                <TableHead className="text-right">ניסיונות</TableHead>
                <TableHead className="text-right">שגיאה אחרונה</TableHead>
                <TableHead className="text-right">עודכן</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveriesLoading && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">טוען...</TableCell></TableRow>
              )}
              {!deliveriesLoading && (deliveries ?? []).length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">אין שליחות</TableCell></TableRow>
              )}
              {!deliveriesLoading && (deliveries ?? []).map((d) => {
                const meta = deliveryStatusMeta(d.status);
                const canRetry = ["failed", "skipped"].includes(d.status) || !DELIVERY_STATUS_LABELS[d.status];
                return (
                  <TableRow key={d.id}>
                    <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                    <TableCell>{d.mentionedUserName}</TableCell>
                    <TableCell>{d.mentionedByName}</TableCell>
                    <TableCell>{d.code ?? "—"}</TableCell>
                    <TableCell>{d.attempts}</TableCell>
                    <TableCell className="max-w-xs truncate">{d.lastError ?? "—"}</TableCell>
                    <TableCell>{fmtDate(d.updatedAt)}</TableCell>
                    <TableCell>
                      {canRetry && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (d.status === "failed") {
                              retryMut.mutate({ deliveryId: d.id });
                            } else {
                              setConfirmRetryId(d.id);
                            }
                          }}
                          disabled={retryMut.isPending}
                        >
                          <ListRestart className="h-3.5 w-3.5 ml-1" />נסה שוב
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className={`text-xs ${isReady ? "text-muted-foreground" : "text-destructive font-medium"}`}>
        כל עוד הכתובת לא מוגדרת ובדיקת התקינות לא עברה — המערכת אינה מוכנה לייצור
      </p>

      <AlertDialog open={!!confirmRetryId} onOpenChange={(open) => { if (!open) setConfirmRetryId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>שליחה חוזרת של הודעת תיוג</AlertDialogTitle>
            <AlertDialogDescription>{UNKNOWN_RETRY_WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRetryId) retryMut.mutate({ deliveryId: confirmRetryId, confirmUnknown: true });
                setConfirmRetryId(null);
              }}
            >
              שלח שוב בכל זאת
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
