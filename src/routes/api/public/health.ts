import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(
          JSON.stringify({ ok: true, ts: new Date().toISOString() }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
