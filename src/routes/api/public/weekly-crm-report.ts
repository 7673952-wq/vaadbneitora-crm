import { createFileRoute } from "@tanstack/react-router";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit.server";
import { timingSafeEqualStr } from "@/lib/webhook-auth.server";

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const Route = createFileRoute("/api/public/weekly-crm-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // The token is accepted ONLY in a header. A query parameter leaks into
        // proxy logs, browser history and referrers, and this endpoint returns
        // caller PII — so `?token=` is rejected even when the value is correct.
        const expected = process.env.WEEKLY_CRM_REPORT_TOKEN ?? "";
        const headerToken =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const okHeader = timingSafeEqualStr(headerToken, expected);
        if (!expected || !okHeader) {
          return new Response("Unauthorized", { status: 401 });
        }

        const limited = await enforcePublicRateLimit(request, "weekly-crm-report", 10, 3600);
        if (limited) return limited;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [{ data: systems, error }, { data: profiles }] = await Promise.all([
          supabaseAdmin
            .from("systems")
            .select("system_code, name, status, phone, caller_phone, source, notes, created_at, updated_at")
            .order("updated_at", { ascending: false }),
          supabaseAdmin.from("profiles").select("id, display_name"),
        ]);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const header = ["מזהה", "שם", "סטטוס", "טלפון לחיוג", "טלפון פונה", "מקור", "הערות", "נוצר", "עודכן"];
        const rows = (systems ?? []).map((s: any) => [
          s.system_code,
          s.name,
          s.status,
          s.phone,
          s.caller_phone,
          s.source,
          s.notes,
          s.created_at,
          s.updated_at,
        ]);
        const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
        return new Response(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="weekly-crm-report-${new Date().toISOString().slice(0, 10)}.csv"`,
            "x-recipient-count": String(profiles?.length ?? 0),
          },
        });
      },
    },
  },
});