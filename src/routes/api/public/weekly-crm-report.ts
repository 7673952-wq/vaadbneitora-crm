import { createFileRoute } from "@tanstack/react-router";

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const Route = createFileRoute("/api/public/weekly-crm-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token");
        const expected = process.env.WEEKLY_CRM_REPORT_TOKEN;
        if (!expected || token !== expected) return new Response("Unauthorized", { status: 401 });

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