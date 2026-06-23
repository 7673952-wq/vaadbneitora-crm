import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";

type Presence = { userId: string; displayName: string; ts: number };

/**
 * Joins a Supabase Realtime presence channel keyed by system id and renders
 * a small banner listing other agents currently viewing the same system.
 * Only the OTHER users (not the current one) are listed.
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

  if (others.length === 0) return null;

  const names = others.map((o) => o.displayName).join(", ");
  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm flex items-center gap-2">
      <Users className="h-4 w-4 shrink-0" />
      <span>
        {others.length === 1
          ? `נציג ${names} נמצא גם במערכת זו`
          : `${others.length} נציגים נמצאים גם במערכת זו: ${names}`}
      </span>
    </div>
  );
}
