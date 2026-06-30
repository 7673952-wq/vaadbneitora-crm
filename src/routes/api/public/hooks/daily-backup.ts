import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/daily-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const expected = process.env.BACKUP_WEBHOOK_SECRET;
        if (!expected || (apikey !== expected && bearer !== expected)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const { runBackup } = await import("@/lib/backups.server");
          const result = await runBackup();
          return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: any) {
          const { logger } = await import("@/lib/logger.server");
          logger.error("daily-backup failed", { message: e?.message, stack: e?.stack });
          return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
