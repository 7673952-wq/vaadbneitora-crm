import { createFileRoute } from "@tanstack/react-router";

const RECIPIENT_EMAIL = process.env.WEEKLY_REPORT_EMAIL ?? "";

export const Route = createFileRoute("/api/public/hooks/weekly-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.BACKUP_WEBHOOK_SECRET;
        if (!expected || !apikey || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const { runBackup } = await import("@/lib/backups.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const result = await runBackup();

          // Build signed URLs (valid 7 days) for each file
          const links: { name: string; url: string }[] = [];
          for (const f of result.files) {
            const { data: signed } = await supabaseAdmin.storage
              .from("backups")
              .createSignedUrl(f.path, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) links.push({ name: f.name, url: signed.signedUrl });
          }

          // Try to send email via Lovable Email (if configured)
          let emailStatus: any = "skipped (no email infra)";
          try {
            const baseUrl = new URL(request.url).origin;
            const sendResp = await fetch(`${baseUrl}/lovable/email/transactional/send`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": process.env.SUPABASE_PUBLISHABLE_KEY!,
                "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
              },
              body: JSON.stringify({
                templateName: "weekly-backup",
                recipientEmail: RECIPIENT_EMAIL,
                idempotencyKey: `weekly-backup-${result.folder}`,
                templateData: { folder: result.folder, links },
              }),
            });
            emailStatus = sendResp.ok ? "sent" : `failed:${sendResp.status}`;
          } catch (e: any) {
            emailStatus = `error:${e?.message ?? "unknown"}`;
          }

          return new Response(JSON.stringify({ ok: true, ...result, links, emailStatus }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: any) {
          const { logger } = await import("@/lib/logger.server");
          logger.error("weekly-backup failed", { message: e?.message, stack: e?.stack });
          return new Response(JSON.stringify({ ok: false, error: e?.message ?? "failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
