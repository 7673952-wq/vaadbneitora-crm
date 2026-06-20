import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { backupNow, listBackups, getBackupFileUrl, getBackupZipUrl, deleteBackup, restoreBackup, prepareBackupEmail } from "@/lib/backups.functions";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { Download, Trash2, Database, RefreshCw, ShieldAlert, Archive, Upload, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/backups")({
  component: BackupsPage,
});

function formatBytes(n: number) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatFolder(name: string) {
  // Folder name is UTC (e.g. 2026-06-12T11-30-00-000Z). Display in Israel time.
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return name;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function BackupsPage() {
  const qc = useQueryClient();
  const meFn = useServerFn(getMyRole);
  const listFn = useServerFn(listBackups);
  const nowFn = useServerFn(backupNow);
  const urlFn = useServerFn(getBackupFileUrl);
  const delFn = useServerFn(deleteBackup);
  const restoreFn = useServerFn(restoreBackup);
  const [restoring, setRestoring] = useState(false);
  const [restorePrompt, setRestorePrompt] = useState<
    | null
    | {
        files: { table: string; csv: string }[];
        mode: "merge" | "replace";
        acknowledged: boolean;
        typed: string;
      }
  >(null);

  async function handleRestoreFilesSelected(fileList: FileList | null) {
    if (!fileList || !fileList.length) return;
    const allowed = new Set(["systems","system_notes","system_activity_log","system_transfers","profiles","user_roles","status_settings"]);
    const files: { table: string; csv: string }[] = [];
    for (const f of Array.from(fileList)) {
      if (/\.zip$/i.test(f.name)) {
        // Unzip in the browser and extract recognized CSVs.
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue;
          const base = entry.name.replace(/^.*\//, "").replace(/\.csv$/i, "");
          if (!allowed.has(base)) continue;
          const text = await entry.async("string");
          files.push({ table: base, csv: text });
        }
        continue;
      }
      const base = f.name.replace(/\.csv$/i, "");
      if (!allowed.has(base)) { toast.error(`קובץ לא נתמך: ${f.name}`); continue; }
      const text = await f.text();
      files.push({ table: base, csv: text });
    }
    if (!files.length) { toast.error("לא נמצאו קבצי CSV נתמכים"); return; }
    // Open the double-confirm dialog; default to safe "merge" mode.
    setRestorePrompt({ files, mode: "merge", acknowledged: false, typed: "" });
  }

  async function executeRestore() {
    if (!restorePrompt) return;
    if (!restorePrompt.acknowledged || restorePrompt.typed.trim() !== "שחזר") return;
    setRestoring(true);
    try {
      const res: any = await restoreFn({
        data: { files: restorePrompt.files, mode: restorePrompt.mode, confirm_token: "שחזר" },
        headers: await getAuthHeaders(),
      });
      const ok = res.filter((r: any) => !r.error).reduce((s: number, r: any) => s + r.inserted, 0);
      const errs = res.filter((r: any) => r.error);
      toast.success(`שוחזרו ${ok} רשומות`);
      if (errs.length) {
        for (const e of errs) {
          toast.error(`${e.table}: ${e.error}`, { duration: 10000 });
        }
      }
      qc.invalidateQueries();
      setRestorePrompt(null);
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בשחזור");
    } finally {
      setRestoring(false);
    }
  }

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => meFn({ headers: await getAuthHeaders() }),
  });

  const { data: backups, isLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: async () => listFn({ headers: await getAuthHeaders() }),
    enabled: me?.isAdmin === true,
  });

  const runMut = useMutation({
    mutationFn: async () => nowFn({ headers: await getAuthHeaders() }),
    onSuccess: (r) => {
      toast.success(`גיבוי הושלם • ${r.files.length} קבצים`);
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בגיבוי"),
  });

  const delMut = useMutation({
    mutationFn: async (folder: string) => delFn({ data: { folder }, headers: await getAuthHeaders() }),
    onSuccess: () => {
      toast.success("גיבוי נמחק");
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });

  const [downloading, setDownloading] = useState<string | null>(null);
  async function download(path: string) {
    try {
      setDownloading(path);
      const { url } = await urlFn({ data: { path }, headers: await getAuthHeaders() });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בהורדה");
    } finally {
      setDownloading(null);
    }
  }

  const zipUrlFn = useServerFn(getBackupZipUrl);
  const [zipping, setZipping] = useState<string | null>(null);
  async function downloadFolderZip(folder: string) {
    try {
      setZipping(folder);
      const { url } = await zipUrlFn({ data: { folder }, headers: await getAuthHeaders() });
      window.open(url, "_blank");
      toast.success("הזיפ מוכן להורדה");
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בהורדת הזיפ");
    } finally {
      setZipping(null);
    }
  }

  if (me && !me.isAdmin) {
    return (
      <div dir="rtl" className="max-w-2xl mx-auto mt-12 rounded-2xl border border-border bg-card p-8 text-center">
        <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold">נדרשות הרשאות מנהל</h2>
        <p className="text-sm text-muted-foreground mt-1">רק מנהלי מערכת יכולים לגשת לגיבויים.</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Database className="h-6 w-6" /> גיבויים
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            גיבוי יומי אוטומטי ב-03:00 + גיבוי שבועי בימי חמישי ב-03:00 (נשלח גם למייל). אפשר גם להפעיל גיבוי ידני בכל רגע.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {me?.isSuperAdmin && (
            <label className={`flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium cursor-pointer hover:bg-accent ${restoring ? "opacity-50 pointer-events-none" : ""}`}>
              <Upload className="h-4 w-4" />
              {restoring ? "משחזר..." : "ייבוא גיבוי"}
              <input type="file" accept=".csv,.zip" multiple className="hidden"
                onChange={(e) => { handleRestoreFilesSelected(e.target.files); e.currentTarget.value = ""; }} />
            </label>
          )}
          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${runMut.isPending ? "animate-spin" : ""}`} />
            {runMut.isPending ? "מגבה..." : "גבה עכשיו"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : !backups || backups.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">אין עדיין גיבויים. לחץ "גבה עכשיו" כדי ליצור גיבוי ראשון.</div>
        ) : (
          <div className="divide-y divide-border">
            {backups.map((b) => (
              <div key={b.folder} className="p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div>
                    <div className="font-medium">{formatFolder(b.folder)}</div>
                    <div className="text-xs text-muted-foreground">{b.files.length} קבצים • {b.folder}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => downloadFolderZip(b.folder)}
                      disabled={zipping === b.folder}
                      className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      title="הורד הכל כ-ZIP"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      {zipping === b.folder ? "מכין ZIP..." : "הורד הכל (ZIP)"}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("למחוק את הגיבוי הזה?")) delMut.mutate(b.folder);
                      }}
                      className="text-destructive hover:bg-destructive/10 p-2 rounded-lg"
                      title="מחק"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.files.map((f) => {
                    const path = `${b.folder}/${f.name}`;
                    return (
                      <button
                        key={f.name}
                        onClick={() => download(path)}
                        disabled={downloading === path}
                        className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent disabled:opacity-50"
                      >
                        <Download className="h-3 w-3" />
                        {f.name}
                        <span className="text-muted-foreground">({formatBytes(f.size)})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        <Link to="/manager-dashboard" className="underline hover:text-foreground">← חזרה לדשבורד מנהלים</Link>
      </div>

      {restorePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" dir="rtl">
          <div className="w-full max-w-lg rounded-2xl border border-destructive/40 bg-card shadow-2xl">
            <div className="p-5 border-b border-border flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <h2 className="font-semibold text-lg">אישור שחזור גיבוי — פעולה הרסנית</h2>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-destructive">
                <div className="font-semibold mb-1">אזהרה</div>
                <div className="text-foreground/90">
                  שחזור גיבוי משנה נתונים במסד הנתונים ולא ניתן לבטלו. הפעולה תתועד ב-Audit Log עם פרטי המשתמש שביצע אותה.
                </div>
              </div>

              <div>
                <div className="text-muted-foreground mb-1">קבצים שייובאו ({restorePrompt.files.length}):</div>
                <ul className="list-disc pr-5 text-foreground/90">
                  {restorePrompt.files.map((f) => (
                    <li key={f.table}>{f.table}.csv</li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="text-muted-foreground mb-2">אופן השחזור:</div>
                <div className="flex gap-2">
                  <label className={`flex-1 cursor-pointer rounded-lg border p-3 ${restorePrompt.mode === "merge" ? "border-primary bg-primary/5" : "border-border"}`}>
                    <input type="radio" name="restore-mode" className="ml-2"
                      checked={restorePrompt.mode === "merge"}
                      onChange={() => setRestorePrompt({ ...restorePrompt, mode: "merge" })}
                    />
                    <span className="font-medium">מיזוג (בטוח)</span>
                    <div className="text-xs text-muted-foreground mt-1">עדכון/הוספה לפי id; לא מוחק רשומות קיימות.</div>
                  </label>
                  <label className={`flex-1 cursor-pointer rounded-lg border p-3 ${restorePrompt.mode === "replace" ? "border-destructive bg-destructive/5" : "border-border"}`}>
                    <input type="radio" name="restore-mode" className="ml-2"
                      checked={restorePrompt.mode === "replace"}
                      onChange={() => setRestorePrompt({ ...restorePrompt, mode: "replace" })}
                    />
                    <span className="font-medium text-destructive">החלפה (הרסנית)</span>
                    <div className="text-xs text-muted-foreground mt-1">מוחק את כל הנתונים בטבלאות שייובאו לפני ההכנסה מחדש.</div>
                  </label>
                </div>
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox"
                  className="mt-1"
                  checked={restorePrompt.acknowledged}
                  onChange={(e) => setRestorePrompt({ ...restorePrompt, acknowledged: e.target.checked })}
                />
                <span>אני מבין שזו פעולה הרסנית שתשפיע על כל המשתמשים, ושהשחזור יתועד ב-Audit Log.</span>
              </label>

              <div>
                <label className="block text-muted-foreground mb-1">להפעלה, הקלד את המילה <code className="px-1 py-0.5 rounded bg-muted">שחזר</code>:</label>
                <input type="text"
                  value={restorePrompt.typed}
                  onChange={(e) => setRestorePrompt({ ...restorePrompt, typed: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-destructive/40"
                  placeholder="שחזר"
                  dir="rtl"
                />
              </div>
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2 bg-muted/30">
              <button
                onClick={() => setRestorePrompt(null)}
                disabled={restoring}
                className="px-4 py-2 rounded-lg border border-border hover:bg-accent text-sm disabled:opacity-50"
              >
                ביטול
              </button>
              <button
                onClick={executeRestore}
                disabled={restoring || !restorePrompt.acknowledged || restorePrompt.typed.trim() !== "שחזר"}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {restoring ? "משחזר..." : "אישור שחזור"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
