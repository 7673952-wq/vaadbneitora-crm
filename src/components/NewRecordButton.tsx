import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMyCrms } from "@/lib/use-crms";

/** Primary "open a new record" action — asks which CRM first. */
export function NewRecordButton() {
  const navigate = useNavigate();
  const { data: crms = [] } = useMyCrms();
  const [open, setOpen] = useState(false);
  const writable = crms.filter((c) => c.myRole && c.myRole !== "viewer");

  if (writable.length === 0) return null;

  function go(key: string) {
    setOpen(false);
    if (key === "yemot") navigate({ to: "/dashboard", search: { new: 1 } as any });
    else navigate({ to: "/c/$crm", params: { crm: key } });
  }

  return (
    <div className="relative">
      <button
        onClick={() => (writable.length === 1 ? go(writable[0].key) : setOpen((v) => !v))}
        className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        פתיחת פניה
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-popover shadow-lg py-1">
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground">באיזו מערכת לפתוח?</div>
            {writable.map((c) => (
              <button
                key={c.key}
                onClick={() => go(c.key)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-right hover:bg-accent"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
