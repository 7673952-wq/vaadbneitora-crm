import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";

// Lightweight health check for uptime monitors. Reports database reachability
// and when the last scheduled backup ran, so a silently-stalled backup is
// visible from outside the app. Returns 503 when a dependency is down.
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await enforcePublicRateLimit(request, "health", 120, 3600);
        if (limited) return limited;

        // Never leak internal error details to an unauthenticated monitor —
        // the response is a plain up/down summary; details go to the log.
        const checks: Record<string, unknown> = {};
        let ok = true;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const started = Date.now();
          const { error } = await supabaseAdmin.from("app_settings").select("key").limit(1);
          if (error) {
            ok = false;
            const { logger } = await import("@/lib/logger.server");
            logger.error("health: database check failed", { message: error.message });
          }
          checks.database = { ok: !error, ms: Date.now() - started };

          const { data: lastRun } = await supabaseAdmin
            .from("app_settings").select("value").eq("key", "backup_schedule_last_run").maybeSingle();
          const at = (lastRun?.value as { at?: string } | null)?.at ?? null;
          const ageHours = at ? (Date.now() - new Date(at).getTime()) / 3_600_000 : null;
          checks.lastBackup = { at, ageHours: ageHours === null ? null : Math.round(ageHours) };
        } catch (e: any) {
          ok = false;
          const { logger } = await import("@/lib/logger.server");
          logger.error("health: unreachable", { message: e?.message, stack: e?.stack });
          checks.database = { ok: false };
        }

        return new Response(JSON.stringify({ ok, ts: new Date().toISOString(), checks }), {
          status: ok ? 200 : 503,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
