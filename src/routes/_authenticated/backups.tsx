import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import { backupNow, listBackups, getBackupFileUrl, deleteBackup } from "@/lib/backups.functions";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";
import { Download, Trash2, Database, RefreshCw, ShieldAlert, Archive } from "lucide-react";

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
  // 2026-06-12T11-30-00-000Z → 12/06/2026 11:30
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  if (!m) return name;
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

function BackupsPage() {
  const qc = useQueryClient();
  const meFn = useServerFn(getMyRole);
  const listFn = useServerFn(listBackups);
  const nowFn = useServerFn(backupNow);
  const urlFn = useServerFn(getBackupFileUrl);
  const delFn = useServerFn(deleteBackup);

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
            גיבוי יומי אוטומטי ב-03:00. אפשר גם להפעיל גיבוי ידני בכל רגע.
          </p>
        </div>
        <button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${runMut.isPending ? "animate-spin" : ""}`} />
          {runMut.isPending ? "מגבה..." : "גבה עכשיו"}
        </button>
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
    </div>
  );
}
