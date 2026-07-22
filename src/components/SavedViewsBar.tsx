import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Plus, Trash2, ChevronDown } from "lucide-react";
import { listSavedViews, createSavedView, deleteSavedView, type SavedViewFilters } from "@/lib/saved-views.functions";

type Props = {
  current: SavedViewFilters;
  onApply: (filters: SavedViewFilters) => void;
};

export function SavedViewsBar({ current, onApply }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSavedViews);
  const createFn = useServerFn(createSavedView);
  const deleteFn = useServerFn(deleteSavedView);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const { data: views } = useQuery({
    queryKey: ["saved-views"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const createMut = useMutation({
    mutationFn: (n: string) => createFn({ data: { name: n, filters: current } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saved-views"] }); setNaming(false); setName(""); },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-views"] }),
  });

  const hasAnyFilter = Object.values(current).some((v) => !!v);

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border border-input bg-white hover:bg-accent">
        <Bookmark className="h-3.5 w-3.5" />
        תצוגות שמורות
        {views && views.length > 0 && <span className="text-[10px] text-muted-foreground">({views.length})</span>}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 right-0 min-w-[260px] bg-popover border border-border rounded-lg shadow-lg p-2 space-y-1">
          {(views ?? []).length === 0 && !naming && (
            <div className="text-xs text-muted-foreground px-2 py-2 text-center">אין תצוגות שמורות עדיין</div>
          )}
          {(views ?? []).map((v) => (
            <div key={v.id} className="flex items-center gap-1 group">
              <button onClick={() => { onApply(v.filters); setOpen(false); }}
                className="flex-1 text-right text-xs px-2 py-1.5 rounded hover:bg-accent truncate">
                {v.name}
              </button>
              <button onClick={() => delMut.mutate(v.id)}
                className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                title="מחק תצוגה">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="border-t border-border pt-1 mt-1">
            {naming ? (
              <div className="flex items-center gap-1">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) createMut.mutate(name.trim()); if (e.key === "Escape") { setNaming(false); setName(""); } }}
                  placeholder="שם התצוגה" className="flex-1 text-xs px-2 py-1 rounded border border-input bg-background" />
                <button disabled={!name.trim() || createMut.isPending}
                  onClick={() => createMut.mutate(name.trim())}
                  className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">
                  שמור
                </button>
              </div>
            ) : (
              <button onClick={() => setNaming(true)} disabled={!hasAnyFilter}
                title={hasAnyFilter ? "שמור את הסינון הנוכחי" : "הגדר סינון כדי לשמור תצוגה"}
                className="w-full flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded hover:bg-accent disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" />שמור תצוגה נוכחית
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
