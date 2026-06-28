import { createFileRoute } from "@tanstack/react-router";

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

          // Resolve recipient from app_settings, fallback to env.
          const { data: setting } = await supabaseAdmin
            .from("app_settings").select("value").eq("key", "backup_email").maybeSingle();
          const recipient = ((setting?.value as { email?: string } | null)?.email ?? process.env.WEEKLY_REPORT_EMAIL ?? "").trim();

          let emailStatus: any = "skipped (no recipient or no RESEND_API_KEY)";
          const apiKey = process.env.RESEND_API_KEY;
          if (recipient && apiKey) {
            try {
              // Build zip of the backup folder.
              const JSZip = (await import("jszip")).default;
              const zip = new JSZip();
              for (const f of result.files) {
                const { data: blob, error } = await supabaseAdmin.storage
                  .from("backups").download(f.path);
                if (error) throw new Error(`${f.name}: ${error.message}`);
                zip.file(f.name, await blob.arrayBuffer());
              }
              const zipBuf = await zip.generateAsync({ type: "uint8array" });
              const base64 = Buffer.from(zipBuf).toString("base64");
              const filename = `backup-${result.folder}.zip`;

              const resp = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  from: "CRM Backups <onboarding@resend.dev>",
                  to: [recipient],
                  subject: `גיבוי CRM שבועי — ${result.folder}`,
                  text: `מצורף קובץ הגיבוי השבועי של ה-CRM (${filename}). גודל: ${(zipBuf.length / 1024).toFixed(0)} KB.`,
                  attachments: [{ filename, content: base64 }],
                }),
              });
              emailStatus = resp.ok ? "sent" : `failed:${resp.status}:${(await resp.text()).slice(0, 200)}`;
            } catch (e: any) {
              emailStatus = `error:${e?.message ?? "unknown"}`;
            }
          }

          return new Response(JSON.stringify({ ok: true, ...result, emailStatus, recipient }), {
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
