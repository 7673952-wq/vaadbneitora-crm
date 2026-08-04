import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Plus, Trash2, Save, X, Search } from "lucide-react";
import {
  listKosherInstructions,
  upsertKosherInstruction,
  deleteKosherInstruction,
} from "@/lib/crms.functions";
import { getMyRole } from "@/lib/admin.functions";
import { getAuthHeaders } from "@/lib/auth-headers";

/**
 * Header button that opens the kosher instructions in a floating window,
 * available from anywhere in the CRM. Supports search + inline editing.
 */
export function KosherButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="הוראות כשרות"
        className="flex items-center justify-center rounded-xl p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition"
      >
        <ShieldCheck className="h-5 w-5" />
      </button>
      {open && <KosherDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function KosherDialog({ onClose }: { onClose: () => void }) {
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
  const canEdit = Boolean((me?.permissions as any)?.settings_manage);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["kosher_instructions"],
    queryFn: async () => listFn({ headers: await getAuthHeaders() }),
  });

  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { title: string; body: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (i) => i.title.toLowerCase().includes(term) || i.body.toLowerCase().includes(term),
    );
  }, [items, q]);

  async function save(id: string | undefined, title: string, body: string, sortOrder: number) {
    if (!title.trim()) { toast.error("נדרשת כותרת"); return; }
    setBusy(true);
    try {
      await saveFn({ data: { id, title, body, sortOrder }, headers: await getAuthHeaders() });
      await qc.invalidateQueries({ queryKey: ["kosher_instructions"] });
      toast.success("נשמר");
      setNewOpen(false); setNewTitle(""); setNewBody(""); setEditing(null);
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
    <div dir="rtl" className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-16" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">הוראות כשרות</h2>
          <div className="relative mr-auto w-64 max-w-[45%]">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="חיפוש בהוראות..."
              className="w-full rounded-lg border border-input bg-background pr-7 pl-2 py-1.5 text-sm"
            />
          </div>
          {canEdit && (
            <button
              onClick={() => setNewOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" /> חדשה
            </button>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {newOpen && canEdit && (
            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="כותרת ההוראה"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium"
              />
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                rows={5}
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
          {!isLoading && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
              {q ? "לא נמצאו הוראות תואמות." : "עדיין לא נכתבו הוראות כשרות."}
            </div>
          )}

          {filtered.map((it) => {
            const draft = drafts[it.id] ?? { title: it.title, body: it.body };
            const isEditing = editing === it.id;
            return (
              <div key={it.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                {isEditing && canEdit ? (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        value={draft.title}
                        onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...draft, title: e.target.value } }))}
                        className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-semibold"
                      />
                      <button
                        disabled={busy}
                        onClick={() => save(it.id, draft.title, draft.body, it.sortOrder)}
                        className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" /> שמור
                      </button>
                      <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-2 py-1.5 text-xs">ביטול</button>
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
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{it.title}</h3>
                      {canEdit && (
                        <div className="mr-auto flex items-center gap-1">
                          <button onClick={() => setEditing(it.id)} className="rounded-lg border border-border px-2 py-1 text-[11px]">עריכה</button>
                          <button onClick={() => remove(it.id)} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
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
    </div>
  );
}
