import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fromSupabase } from "@/lib/errors";

export type GlobalSearchHit = {
  crmKey: string;
  crmName: string;
  crmColor: string;
  id: string;
  code: string;
  name: string;
  status: string;
  phone: string | null;
  email: string | null;
  matchedOn: string;
};

/** Cross-CRM search: id / name / caller / phone / email / notes. */
export const globalSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ q: z.string().trim().min(2).max(120) }).parse(input))
  .handler(async ({ data, context }): Promise<GlobalSearchHit[]> => {
    const { hasCrmAccess } = await import("@/lib/permissions.server");
    const q = data.q;
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const digits = q.replace(/\D/g, "");

    const { data: crms, error: crmErr } = await context.supabase.from("crms").select("key, name, color");
    if (crmErr) throw fromSupabase(crmErr);
    const meta = new Map<string, { name: string; color: string }>(
      (crms ?? []).map((c: any) => [c.key as string, { name: c.name as string, color: c.color as string }]),
    );

    const orParts = [
      `system_code.ilike.${like}`,
      `name.ilike.${like}`,
      `notes.ilike.${like}`,
      `email.ilike.${like}`,
      `source.ilike.${like}`,
    ];
    if (digits.length >= 3) {
      orParts.push(`phone.ilike.%${digits}%`, `caller_phone.ilike.%${digits}%`);
    }

    const [systemsRes, recordsRes] = await Promise.all([
      context.supabase
        .from("systems")
        .select("id, system_code, name, status, phone, caller_phone, email, notes")
        .or(orParts.join(","))
        .limit(25),
      context.supabase
        .from("crm_records")
        .select("id, crm_key, record_code, name, status, phone, caller_phone, email, notes")
        .or(
          [
            `record_code.ilike.${like}`,
            `name.ilike.${like}`,
            `notes.ilike.${like}`,
            `email.ilike.${like}`,
            `source.ilike.${like}`,
            ...(digits.length >= 3 ? [`phone.ilike.%${digits}%`, `caller_phone.ilike.%${digits}%`] : []),
          ].join(","),
        )
        .limit(25),
    ]);

    const hits: GlobalSearchHit[] = [];
    const yemot = meta.get("yemot") ?? { name: "ימות המשיח", color: "#2563eb" };
    if (await hasCrmAccess(context.userId, "yemot")) for (const s of (systemsRes.data ?? []) as any[]) {
      hits.push({
        crmKey: "yemot",
        crmName: yemot.name,
        crmColor: yemot.color,
        id: s.id,
        code: s.system_code,
        name: s.name ?? "",
        status: s.status ?? "",
        phone: s.phone ?? s.caller_phone ?? null,
        email: s.email ?? null,
        matchedOn: "",
      });
    }
    for (const r of (recordsRes.data ?? []) as any[]) {
      const m = meta.get(r.crm_key) ?? { name: r.crm_key, color: "#64748b" };
      hits.push({
        crmKey: r.crm_key,
        crmName: m.name,
        crmColor: m.color,
        id: r.id,
        code: r.record_code,
        name: r.name ?? "",
        status: r.status ?? "",
        phone: r.phone ?? r.caller_phone ?? null,
        email: r.email ?? null,
        matchedOn: "",
      });
    }
    return hits;
  });
