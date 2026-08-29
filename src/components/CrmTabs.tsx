import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMyCrms } from "@/lib/use-crms";
import { countPendingRequests } from "@/lib/system-requests.functions";
import { Settings2, Mail, Inbox } from "lucide-react";

/**
 * Dark "command console" CRM switcher — an inverted segmented control that
 * contrasts against the floating header. Inverts cleanly in dark mode too.
 */
export function CrmTabs({ isAdmin = false, canMail = false, canRequests = false }: { isAdmin?: boolean; canMail?: boolean; canRequests?: boolean }) {
  const { data: crms = [] } = useMyCrms();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const fetchPending = useServerFn(countPendingRequests);
  // No permission → no background count query at all.
  const { data: pending } = useQuery({
    queryKey: ["requests", "pending-count"],
    queryFn: () => fetchPending(),
    enabled: canRequests,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const pendingCount = canRequests ? (pending?.count ?? 0) : 0;

  const crmTabs = crms.map((c) => ({
    key: c.key,
    label: c.name,
    color: c.color,
    to: c.key === "yemot" ? "/dashboard" : `/c/${c.key}`,
    active:
      c.key === "yemot"
        ? path.startsWith("/dashboard") || path.startsWith("/systems") || path.startsWith("/charts") || path.startsWith("/manager-dashboard")
        : path.startsWith(`/c/${c.key}`),
  }));

  if (crmTabs.length === 0 && !isAdmin) return null;

  return (
    <nav className="flex items-center gap-0.5 min-w-0 overflow-x-auto no-scrollbar rounded-full bg-foreground/95 p-1 shadow-sm">
      {crmTabs.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
            t.active
              ? "bg-background text-foreground shadow-sm"
              : "text-background/55 hover:text-background hover:bg-background/10"
          }`}
        >
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
          {t.label}
        </Link>
      ))}
      {canMail && (
      <Link
        to="/mail"
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
          path.startsWith("/mail")
            ? "bg-background text-foreground shadow-sm"
            : "text-background/55 hover:text-background hover:bg-background/10"
        }`}
      >
        <Mail className="h-4 w-4" />
        מיילים
      </Link>
      )}

      {canRequests && (
        <Link
          to="/requests"
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
            path.startsWith("/requests")
              ? "bg-background text-foreground shadow-sm"
              : "text-background/55 hover:text-background hover:bg-background/10"
          }`}
        >
          <Inbox className="h-4 w-4" />
          בקשות
          {pendingCount > 0 && (
            <span className="min-w-5 rounded-full bg-destructive px-1.5 text-[11px] font-bold leading-5 text-destructive-foreground">
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
        </Link>
      )}

      {isAdmin && (
        <Link
          to="/admin"
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
            path.startsWith("/admin")
              ? "bg-background text-foreground shadow-sm"
              : "text-background/55 hover:text-background hover:bg-background/10"
          }`}
        >
          <Settings2 className="h-4 w-4" />
          ניהול
        </Link>
      )}
    </nav>
  );
}
