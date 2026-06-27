import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, X } from "lucide-react";

type Presence = { userId: string; displayName: string; ts: number };

/**
 * Joins a Supabase Realtime presence channel keyed by system id and renders
 * a prominent floating red banner when other agents are viewing the same
 * system. The banner shows a 10-second countdown timer and an X to dismiss
 * it; after dismissal/timeout it collapses into a small static notice at
 * the top of the page. When every other agent leaves, the notice disappears.
 */
export function SystemPresence({
  systemId,
  userId,
  displayName,
}: {
  systemId: string;
  userId: string;
  displayName: string;
}) {
  const [others, setOthers] = useState<Presence[]>([]);
  const [floating, setFloating] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(10);
  const dismissedKeyRef = useRef<string>("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!systemId || !userId) return;
    const channel = supabase.channel(`system-presence:${systemId}`, {
      config: { presence: { key: userId } },
    });

    const recompute = () => {
      const state = channel.presenceState() as Record<string, Presence[]>;
      const seen = new Map<string, Presence>();
      for (const [key, metas] of Object.entries(state)) {
        if (key === userId) continue;
        const meta = metas?.[0];
        if (meta?.displayName) seen.set(key, meta);
      }
      setOthers(Array.from(seen.values()));
    };

    channel
      .on("presence", { event: "sync" }, recompute)
      .on("presence", { event: "join" }, recompute)
      .on("presence", { event: "leave" }, recompute)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId, displayName: displayName || "נציג", ts: Date.now() });
        }
      });

    return () => {
      try { channel.untrack(); } catch { /* noop */ }
      supabase.removeChannel(channel);
    };
  }, [systemId, userId, displayName]);

  // Whenever the set of other viewers changes, re-arm the floating banner
  // (but only if the new set hasn't already been dismissed by the user).
  useEffect(() => {
    if (others.length === 0) {
      setFloating(false);
      dismissedKeyRef.current = "";
      return;
    }
    const key = others.map((o) => o.userId).sort().join(",");
    if (dismissedKeyRef.current === key) return; // already dismissed for this group
    setFloating(true);
    setSecondsLeft(10);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          setFloating(false);
          dismissedKeyRef.current = key;
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [others]);

  if (others.length === 0) return null;

  const names = others.map((o) => o.displayName).join(", ");
  const text = others.length === 1
    ? `שים לב — ${names} נמצא/ת כעת באותה מערכת`
    : `שים לב — ${others.length} נציגים נמצאים כעת באותה מערכת: ${names}`;

  const dismiss = () => {
    const key = others.map((o) => o.userId).sort().join(",");
    dismissedKeyRef.current = key;
    setFloating(false);
    if (tickRef.current) clearInterval(tickRef.current);
  };

  return (
    <>
      {/* Persistent compact notice at the top of the card */}
      <div className="rounded-lg border-2 border-red-300 bg-red-50 text-red-900 px-3 py-2 text-sm flex items-center gap-2">
        <Users className="h-4 w-4 shrink-0" />
        <span>{text}</span>
      </div>

      {/* Floating attention-grabbing banner for 10 seconds */}
      {floating && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-[92vw] w-auto rounded-xl border-2 border-red-600 bg-red-500 text-white px-5 py-3 shadow-2xl flex items-center gap-3 animate-pulse"
          role="alert"
        >
          <Users className="h-5 w-5 shrink-0" />
          <span className="font-bold text-sm md:text-base">{text}</span>
          <span className="text-xs font-mono bg-red-700/60 rounded-full px-2 py-0.5 tabular-nums">
            {secondsLeft}s
          </span>
          <button
            onClick={dismiss}
            aria-label="סגור התראה"
            className="ms-1 p-1 rounded-full hover:bg-red-700/60 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}
