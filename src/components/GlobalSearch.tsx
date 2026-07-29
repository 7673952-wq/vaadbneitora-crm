import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2 } from "lucide-react";
import { globalSearch } from "@/lib/global-search.functions";
import { getAuthHeaders } from "@/lib/auth-headers";

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

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["global_search", debounced],
    queryFn: async () => fn({ data: { q: debounced }, headers: await getAuthHeaders() }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });

  return (
    <div ref={boxRef} className="relative hidden md:block">
      <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="חיפוש בכל המערכות..."
        className="w-72 rounded-lg border border-input bg-background pr-8 pl-3 py-1.5 text-sm"
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
