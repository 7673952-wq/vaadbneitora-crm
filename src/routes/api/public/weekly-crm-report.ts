import { createFileRoute } from "@tanstack/react-router";
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
        // Prefer the token in a header — query params leak into proxy logs
        // and browser history, and this endpoint returns caller PII.
        const expected = process.env.WEEKLY_CRM_REPORT_TOKEN ?? "";
        const headerToken =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const queryToken = new URL(request.url).searchParams.get("token") ?? "";
        const okHeader = timingSafeEqualStr(headerToken, expected);
        const okQuery = timingSafeEqualStr(queryToken, expected);
        if (!expected || (!okHeader && !okQuery)) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (!okHeader) {
          console.warn("[weekly-crm-report] token passed via query param — move it to the apikey header");
        }

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