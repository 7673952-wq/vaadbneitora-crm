import { Link, useRouterState } from "@tanstack/react-router";
import { useMyCrms } from "@/lib/use-crms";
import { ShieldCheck, Settings2, Mail } from "lucide-react";

/**
 * Top-level tab bar switching between the different CRMs plus the global
 * tabs (kosher instructions, general settings). Hidden entirely when the
 * user has access to a single CRM and no global tabs.
 */
export function CrmTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const { data: crms = [] } = useMyCrms();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const crmTabs = crms.map((c) => ({
    key: c.key,
    label: c.name,
    color: c.color,
    to: c.key === "yemot" ? "/dashboard" : `/c/${c.key}`,
    active: c.key === "yemot"
      ? path.startsWith("/dashboard") || path.startsWith("/systems")
      : path.startsWith(`/c/${c.key}`),
  }));

  if (crmTabs.length <= 1 && !isAdmin) return null;

  return (
    <div className="border-b border-border bg-muted/30">
      <div className="max-w-[1600px] mx-auto px-6 flex items-center gap-1 overflow-x-auto">
        {crmTabs.map((t) => (
          <Link
            key={t.key}
            to={t.to}
            className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition ${
              t.active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
              {t.label}
            </span>
            {t.active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: t.color }} />
            )}
          </Link>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <Link
          to="/mail"
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition ${
            path.startsWith("/mail") ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Mail className="h-4 w-4" />
          מייל
          {path.startsWith("/mail") && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
        </Link>
        <Link
          to="/kosher"
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition ${
            path.startsWith("/kosher") ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          הוראות כשרות
          {path.startsWith("/kosher") && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
        </Link>

        {isAdmin && (
          <Link
            to="/admin"
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition ${
              path.startsWith("/admin") ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Settings2 className="h-4 w-4" />
            כללי
            {path.startsWith("/admin") && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </Link>
        )}
      </div>
    </div>
  );
}
