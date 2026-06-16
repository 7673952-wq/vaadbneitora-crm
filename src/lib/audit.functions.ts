import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    actor_id?: string | null;
    action?: string | null;
    from?: string | null;
    to?: string | null;
    search?: string | null;
    limit?: number | null;
  }) =>
    z.object({
      actor_id: z.string().uuid().nullable().optional(),
      action: z.string().max(60).nullable().optional(),
      from: z.string().datetime().nullable().optional(),
      to: z.string().datetime().nullable().optional(),
      search: z.string().max(200).nullable().optional(),
      limit: z.number().int().min(1).max(5000).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("system_activity_log")
      .select("id, system_id, actor_id, actor_display_name, action, field, old_value, new_value, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 1000);

    if (data.actor_id) q = q.eq("actor_id", data.actor_id);
    if (data.action) q = q.eq("action", data.action);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.search && data.search.trim()) {
      const s = data.search.trim().replace(/[%,]/g, " ");
      q = q.or(
        [
          `actor_display_name.ilike.%${s}%`,
          `field.ilike.%${s}%`,
          `old_value.ilike.%${s}%`,
          `new_value.ilike.%${s}%`,
          `reason.ilike.%${s}%`,
          `action.ilike.%${s}%`,
        ].join(","),
      );
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const systemIds = Array.from(new Set((rows ?? []).map((r: any) => r.system_id).filter(Boolean) as string[]));
    const actorIds = Array.from(new Set((rows ?? []).map((r: any) => r.actor_id).filter(Boolean) as string[]));
    const valueIds: string[] = [];
    for (const r of rows ?? []) {
      if (r.field === "assigned_agent_id") {
        if (r.old_value) valueIds.push(r.old_value);
        if (r.new_value) valueIds.push(r.new_value);
      }
    }
    const allProfileIds = Array.from(new Set([...actorIds, ...valueIds]));

    const [systemsRes, profilesRes] = await Promise.all([
      systemIds.length
        ? context.supabase.from("systems").select("id, system_code, name").in("id", systemIds)
        : Promise.resolve({ data: [] as any[] }),
      allProfileIds.length
        ? context.supabase.from("profiles").select("id, display_name").in("id", allProfileIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const sysMap = new Map((systemsRes.data ?? []).map((s: any) => [s.id, s]));
    const profMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.display_name]));

    return (rows ?? []).map((r: any) => ({
      ...r,
      actor_name: r.actor_display_name ?? (r.actor_id ? profMap.get(r.actor_id) ?? "לא ידוע" : "מערכת"),
      system: r.system_id ? sysMap.get(r.system_id) ?? null : null,
      old_display:
        r.field === "assigned_agent_id" && r.old_value ? profMap.get(r.old_value) ?? r.old_value : r.old_value,
      new_display:
        r.field === "assigned_agent_id" && r.new_value ? profMap.get(r.new_value) ?? r.new_value : r.new_value,
    }));
  });

export const listAuditActors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles").select("id, display_name").order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
