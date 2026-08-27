import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2 } from "lucide-react";
import { globalSearch } from "@/lib/global-search.functions";

/** Header search box that queries every CRM at once. */
export function GlobalSearch() {
  const fn = useServerFn(globalSearch);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Ctrl/Cmd+K jumps straight to the cross-CRM search from anywhere.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      } else if (e.key === "Escape" && document.activeElement === inputRef.current) {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["global_search", debounced],
    queryFn: async () => fn({ data: { q: debounced } }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });

  return (
    <div ref={boxRef} className="relative hidden md:block">
      <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="חיפוש כללי... (Ctrl+K)"
        aria-label="חיפוש כללי בכל המערכות"
        className="w-56 rounded-xl border-none bg-muted pr-9 pl-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-background transition-all outline-none"
      />
      {isFetching && <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {open && debounced.length >= 2 && (
        <div className="absolute top-full mt-1 right-0 w-[26rem] max-h-96 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg z-50">
          {hits.length === 0 && !isFetching && (
            <div className="p-3 text-sm text-muted-foreground">לא נמצאו תוצאות</div>
          )}
          {hits.map((h) => {
            const content = (
              <>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: h.crmColor }} />
                <span className="font-medium">{h.code}</span>
                <span className="text-muted-foreground truncate flex-1">{h.name}</span>
                <span className="text-[11px] text-muted-foreground">{h.crmName}</span>
              </>
            );
            return h.crmKey === "yemot" ? (
              <Link
                key={`${h.crmKey}-${h.id}`}
                to="/systems/$id"
                params={{ id: h.id }}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              >
                {content}
              </Link>
            ) : (
              <Link
                key={`${h.crmKey}-${h.id}`}
                to="/c/$crm/$id"
                params={{ crm: h.crmKey, id: h.id }}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              >
                {content}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
