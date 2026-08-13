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

        const checks: Record<string, unknown> = {};
        let ok = true;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const started = Date.now();
          const { error } = await supabaseAdmin.from("app_settings").select("key").limit(1);
          checks.database = error ? { ok: false, error: error.message } : { ok: true, ms: Date.now() - started };
          if (error) ok = false;

          const { data: lastRun } = await supabaseAdmin
            .from("app_settings").select("value").eq("key", "backup_schedule_last_run").maybeSingle();
          const at = (lastRun?.value as { at?: string } | null)?.at ?? null;
          const ageHours = at ? (Date.now() - new Date(at).getTime()) / 3_600_000 : null;
          checks.lastBackup = { at, ageHours: ageHours === null ? null : Math.round(ageHours) };
        } catch (e: any) {
          ok = false;
          checks.database = { ok: false, error: e?.message ?? "unreachable" };
        }

        return new Response(JSON.stringify({ ok, ts: new Date().toISOString(), checks }), {
          status: ok ? 200 : 503,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
