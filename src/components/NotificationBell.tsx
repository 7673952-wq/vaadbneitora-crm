import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, ArrowRightLeft, MessageSquare, Activity, AlarmClock, X, AtSign } from "lucide-react";
import { listMyNotifications } from "@/lib/admin.functions";
import { listDueReminders, dismissReminder } from "@/lib/systems.functions";

const LS_KEY = "notif_last_read_at";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} ד'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} ש'`;
  const d = Math.floor(h / 24);
  return `לפני ${d} ימים`;
}

export function NotificationBell() {
  const fn = useServerFn(listMyNotifications);
  const remindersFn = useServerFn(listDueReminders);
  const dismissFn = useServerFn(dismissReminder);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["my_notifications"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const { data: remindersData } = useQuery({
    queryKey: ["my_due_reminders"],
    queryFn: () => remindersFn(),
    refetchInterval: 60_000,
  });

  const rawItems = (data ?? []) as any[];
  const items = useMemo(() => {
    const cutoff = Date.now() - MAX_AGE_MS;
    return rawItems.filter((n) => new Date(n.created_at).getTime() >= cutoff);
  }, [rawItems]);
  const reminders = (remindersData ?? []) as any[];

  const dismissMut = useMutation({
    mutationFn: (id: string) => dismissFn({ data: { system_id: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my_due_reminders"] });
      qc.invalidateQueries({ queryKey: ["systems"] });
    },
  });

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lastRead, setLastRead] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem(LS_KEY) || 0);
  });
  const unreadNotifs = useMemo(
    () => items.filter((n) => new Date(n.created_at).getTime() > lastRead).length,
    [items, lastRead],
  );
  // Reminders always count until dismissed
  const unread = unreadNotifs + reminders.length;

  useEffect(() => {
    if (open && items.length) {
      const newest = new Date(items[0].created_at).getTime();
      if (newest > lastRead) {
        window.localStorage.setItem(LS_KEY, String(newest));
        setLastRead(newest);
      }
    }
  }, [open, items, lastRead]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasReminders = reminders.length > 0;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="התראות"
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent ${hasReminders ? "animate-pulse-stale" : ""}`}
      >
        <Bell className={`h-5 w-5 ${hasReminders ? "text-red-600" : ""}`} />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[380px] max-h-[520px] overflow-auto rounded-xl border border-border bg-popover shadow-xl">
          <div className="sticky top-0 bg-popover/95 backdrop-blur px-3 py-2 border-b text-sm font-semibold flex items-center justify-between">
            <span>התראות {unread > 0 && <span className="text-xs text-red-600">({unread} חדשות)</span>}</span>
            <span className="text-[10px] text-muted-foreground font-normal">7 ימים אחרונים</span>
          </div>

          {hasReminders && (
            <div className="border-b bg-red-50/60">
              <div className="px-3 py-1.5 text-[11px] font-bold text-red-800 uppercase tracking-wide flex items-center gap-1">
                <AlarmClock className="h-3.5 w-3.5" /> תזכורות פעילות ({reminders.length})
              </div>
              <ul className="divide-y divide-red-200">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-stretch">
                    <Link
                      to="/systems/$id"
                      params={{ id: r.id }}
                      onClick={() => setOpen(false)}
                      className="flex-1 flex gap-2 p-3 text-sm hover:bg-red-100/60"
                    >
                      <AlarmClock className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">
                            {r.system_code} · {r.name}
                          </span>
                          {r.reminder_at && (
                            <span className="text-[10px] text-red-700 shrink-0">
                              {timeAgo(r.reminder_at)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-red-800/80">
                          {r.source === "manual" ? "תזכורת ידנית" : r.source === "stale" ? "ללא טיפול" : r.source === "assigned" ? "ממתין לנציג" : "ממתין לטיפול"}
                        </div>
                      </div>
                    </Link>
                    <button
                      title="סגור תזכורת"
                      disabled={dismissMut.isPending}
                      onClick={(e) => { e.stopPropagation(); dismissMut.mutate(r.id); }}
                      className="px-2 flex items-center justify-center text-red-700 hover:bg-red-200/70 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {items.length === 0 && !hasReminders ? (
            <div className="p-4 text-sm text-muted-foreground text-center">אין התראות חדשות</div>
          ) : items.length === 0 ? null : (
            <ul className="divide-y">
              {items.map((n) => {
                const isUnread = new Date(n.created_at).getTime() > lastRead;
                const Icon = n.kind === "transfer" ? ArrowRightLeft : n.kind === "note" ? MessageSquare : n.kind === "mention" ? AtSign : Activity;
                return (
                  <li key={n.id} className={isUnread ? "bg-amber-50/60" : ""}>
                    <Link
                      to="/systems/$id"
                      params={{ id: n.system_id }}
                      onClick={() => setOpen(false)}
                      className="flex gap-2 p-3 text-sm hover:bg-accent"
                    >
                      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{n.title}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {n.system_code} · {n.system_name}
                        </div>
                        <div className="text-xs mt-0.5 truncate">
                          <span className="text-muted-foreground">{n.detail}</span>
                          {n.reason && <span className="text-foreground/80"> · {n.reason}</span>}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
