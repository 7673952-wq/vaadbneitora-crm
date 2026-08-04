import { Link, useRouterState } from "@tanstack/react-router";
import { useMyCrms } from "@/lib/use-crms";
import { Settings2 } from "lucide-react";

/**
 * Inline CRM switcher rendered inside the single top header row.
 * Shows only the CRMs the signed-in user has access to, plus the admin tab.
 */
export function CrmTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const { data: crms = [] } = useMyCrms();
  const path = useRouterState({ select: (s) => s.location.pathname });

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
    <nav className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
      {crmTabs.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition ${
            t.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
          }`}
        >
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
          {t.label}
        </Link>
      ))}
      {isAdmin && (
        <Link
          to="/admin"
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition ${
            path.startsWith("/admin") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
          }`}
        >
          <Settings2 className="h-4 w-4" />
          ניהול
        </Link>
      )}
    </nav>
  );
}
