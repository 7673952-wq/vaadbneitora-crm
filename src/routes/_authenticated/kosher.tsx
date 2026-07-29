import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Plus, Trash2, Save } from "lucide-react";
import {
  listKosherInstructions,
  upsertKosherInstruction,
  deleteKosherInstruction,
} from "@/lib/crms.functions";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";

export const Route = createFileRoute("/_authenticated/kosher")({
  component: KosherPage,
});

function KosherPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listKosherInstructions);
  const saveFn = useServerFn(upsertKosherInstruction);
  const delFn = useServerFn(deleteKosherInstruction);
  const roleFn = useServerFn(getMyRole);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => roleFn({ headers: await getAuthHeaders() }),
    staleTime: 5 * 60_000,
  });
  const canEdit = Boolean(me?.permissions?.settings_manage);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["kosher_instructions"],
    queryFn: async () => listFn({ headers: await getAuthHeaders() }),
  });

  const [drafts, setDrafts] = useState<Record<string, { title: string; body: string }>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(id: string | undefined, title: string, body: string, sortOrder: number) {
    if (!title.trim()) { toast.error("נדרשת כותרת"); return; }
    setBusy(true);
    try {
      await saveFn({ data: { id, title, body, sortOrder }, headers: await getAuthHeaders() });
      await qc.invalidateQueries({ queryKey: ["kosher_instructions"] });
      toast.success("נשמר");
      setNewOpen(false); setNewTitle(""); setNewBody("");
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בשמירה");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("למחוק את ההוראה?")) return;
    try {
      await delFn({ data: { id }, headers: await getAuthHeaders() });
      await qc.invalidateQueries({ queryKey: ["kosher_instructions"] });
      toast.success("נמחק");
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה במחיקה");
    }
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          הוראות כשרות
        </h1>
        {canEdit && (
          <button
            onClick={() => setNewOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> הוראה חדשה
          </button>
        )}
      </div>

      {newOpen && canEdit && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="כותרת ההוראה"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium"
          />
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={6}
            placeholder="תוכן ההוראה..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            disabled={busy}
            onClick={() => save(undefined, newTitle, newBody, items.length)}
            className="rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            שמור
          </button>
        </div>
      )}

      {isLoading && <div className="text-sm text-muted-foreground">טוען...</div>}
      {!isLoading && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
          עדיין לא נכתבו הוראות כשרות.
        </div>
      )}

      <div className="space-y-3">
        {items.map((it) => {
          const draft = drafts[it.id] ?? { title: it.title, body: it.body };
          const dirty = draft.title !== it.title || draft.body !== it.body;
          return (
            <div key={it.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
              {canEdit ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      value={draft.title}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...draft, title: e.target.value } }))}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-semibold"
                    />
                    {dirty && (
                      <button
                        disabled={busy}
                        onClick={() => save(it.id, draft.title, draft.body, it.sortOrder)}
                        className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" /> שמור
                      </button>
                    )}
                    <button
                      onClick={() => remove(it.id)}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive"
                      title="מחק"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...draft, body: e.target.value } }))}
                    rows={6}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  />
                </>
              ) : (
                <>
                  <h2 className="font-semibold">{it.title}</h2>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{it.body}</p>
                </>
              )}
              <div className="text-[11px] text-muted-foreground">
                עודכן {new Date(it.updatedAt).toLocaleString("he-IL")}
                {it.updatedByName ? ` · ${it.updatedByName}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
