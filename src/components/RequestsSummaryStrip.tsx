import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, ArrowLeft } from "lucide-react";
import { getRequestsSummary } from "@/lib/system-requests.functions";

/**
 * One-line daily digest of the email request automation, with a direct link to
 * the decision queue. Only queried for users holding `requests_view`.
 */
export function RequestsSummaryStrip({ canView }: { canView: boolean }) {
  const fetchFn = useServerFn(getRequestsSummary);
  const { data } = useQuery({
    queryKey: ["requests", "summary"],
    queryFn: () => fetchFn(),
    enabled: canView,
    staleTime: 60_000,
    refetchInterval: 180_000,
  });

  if (!canView || !data) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-semibold">
        <Inbox className="h-4 w-4 text-primary" />
        בקשות מייל (24 שעות)
      </span>
      <span className="text-muted-foreground">התקבלו: <b className="text-foreground">{data.today}</b></span>
      <span className="text-muted-foreground">פתיחה: <b className="text-foreground">{data.pticha}</b></span>
      <span className="text-muted-foreground">סגירה: <b className="text-foreground">{data.sgira}</b></span>
      <span className="text-muted-foreground">בוצעו: <b className="text-foreground">{data.applied}</b></span>
      {data.dryRun > 0 && <span className="text-amber-700">במצב בדיקה: {data.dryRun}</span>}
      <Link to="/requests" className="ms-auto flex items-center gap-1 font-medium text-primary hover:underline">
        דורשים החלטה
        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
          {data.pending}
        </span>
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
