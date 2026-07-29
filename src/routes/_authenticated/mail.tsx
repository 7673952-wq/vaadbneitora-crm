import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, Search, ExternalLink } from "lucide-react";
import { listMailContacts, getMailConversation } from "@/lib/mail.functions";
import { getAuthHeaders } from "@/lib/auth-headers";

export const Route = createFileRoute("/_authenticated/mail")({
  head: () => ({
    meta: [
      { title: "מייל | CRM" },
      { name: "description", content: "תיבת מייל מאוחדת לכל מערכות ה-CRM, לפי כתובת מייל." },
      { property: "og:title", content: "מייל | CRM" },
      { property: "og:description", content: "תיבת מייל מאוחדת לכל מערכות ה-CRM." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MailPage,
});

function MailPage() {
  const contactsFn = useServerFn(listMailContacts);
  const convFn = useServerFn(getMailConversation);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["mail_contacts", search],
    queryFn: async () => contactsFn({ data: { search }, headers: await getAuthHeaders() }),
    staleTime: 30_000,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["mail_conversation", active],
    queryFn: async () => convFn({ data: { address: active! }, headers: await getAuthHeaders() }),
    enabled: !!active,
  });

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Mail className="h-5 w-5" /> מייל
        </h1>
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי כתובת או נושא..."
            className="w-72 rounded-lg border border-input bg-background pr-8 pl-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
            {isLoading && <div className="p-3 text-sm text-muted-foreground">טוען...</div>}
            {!isLoading && contacts.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">אין התכתבויות</div>
            )}
            {contacts.map((c) => (
              <button
                key={c.address}
                onClick={() => setActive(c.address)}
                className={`w-full text-right px-3 py-2.5 hover:bg-accent transition ${active === c.address ? "bg-accent" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{c.address}</span>
                  {c.unread && <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />}
                  <span className="mr-auto text-[11px] text-muted-foreground shrink-0">{c.count}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{c.lastSubject ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground">{new Date(c.lastAt).toLocaleString("he-IL")}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          {!active && <p className="text-sm text-muted-foreground">בחר כתובת מייל כדי לראות את ההתכתבות</p>}
          {active && (
            <>
              <div className="flex items-center gap-2 border-b border-border pb-2 mb-3">
                <h2 className="text-sm font-semibold">{active}</h2>
              </div>
              <div className="space-y-3 max-h-[65vh] overflow-y-auto">
                {messages.map((m) => {
                  const inbound = m.direction === "in" || m.direction === "inbound";
                  return (
                    <div
                      key={m.id}
                      className={`rounded-lg border border-border p-3 ${inbound ? "bg-muted/40" : "bg-primary/5"}`}
                    >
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                        <span className="font-medium text-foreground">{inbound ? m.fromAddress : m.agentName ?? "נציג"}</span>
                        <span>{new Date(m.createdAt).toLocaleString("he-IL")}</span>
                        {m.systemId && (
                          <Link
                            to="/systems/$id"
                            params={{ id: m.systemId }}
                            className="mr-auto flex items-center gap-1 hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" /> למערכת
                          </Link>
                        )}
                      </div>
                      {m.subject && <div className="text-sm font-medium">{m.subject}</div>}
                      <p className="text-sm whitespace-pre-wrap mt-1">{m.body}</p>
                    </div>
                  );
                })}
                {messages.length === 0 && <p className="text-sm text-muted-foreground">אין הודעות</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
