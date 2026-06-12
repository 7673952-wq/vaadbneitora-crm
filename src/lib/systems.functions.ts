import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUS_VALUES = [
  "pending_check_close", "pending_check_open", "open", "to_open", "closed",
  "to_block", "block_from_root", "problem", "open_only_bimot", "close_only_bimot",
  "open_in_simahedrin", "close_in_simahedrin", "send_to_yosela",
] as const;
const statusSchema = z.enum(STATUS_VALUES);
const REPEAT_VALUES = ["day", "week", "month", "2months", "year", "custom"] as const;

async function setReason(supabase: any, reason?: string | null) {
  if (!reason) return;
  // session-local config consumed by log_system_changes trigger
  await supabase.rpc("set_change_reason", { p_reason: reason }).then(() => {}, () => {});
}

export const listSystems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string | null; agentId?: string | null; period?: string | null }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("systems")
      .select("id, system_code, name, status, assigned_agent_id, notes, phone, caller_phone, source, reminder_at, reminder_agent_ids, handled_pending_at, parent_system_id, audio_url, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (data.status) q = q.eq("status", data.status as any);
    if (data.agentId) q = q.eq("assigned_agent_id", data.agentId);
    if (data.period) {
      const now = new Date();
      const start = new Date(now);
      if (data.period === "day") start.setDate(now.getDate() - 1);
      else if (data.period === "week") start.setDate(now.getDate() - 7);
      else if (data.period === "month") start.setMonth(now.getMonth() - 1);
      else if (data.period === "year") start.setFullYear(now.getFullYear() - 1);
      q = q.gte("updated_at", start.toISOString());
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const { data: profiles } = await context.supabase.from("profiles").select("id, display_name");
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const parentIds = Array.from(new Set((rows ?? []).map((r) => r.parent_system_id).filter(Boolean) as string[]));
    let parentMap = new Map<string, { id: string; system_code: string; name: string }>();
    if (parentIds.length) {
      const { data: parents } = await context.supabase
        .from("systems").select("id, system_code, name").in("id", parentIds);
      parentMap = new Map((parents ?? []).map((p) => [p.id, p]));
    }
    return (rows ?? []).map((r) => ({
      ...r,
      agent: r.assigned_agent_id ? profileMap.get(r.assigned_agent_id) ?? null : null,
      parent: r.parent_system_id ? parentMap.get(r.parent_system_id) ?? null : null,
    }));
  });

export const getSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sys, error } = await context.supabase
      .from("systems").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sys) throw new Error("מערכת לא נמצאה");

    const { data: notes } = await context.supabase
      .from("system_notes").select("*").eq("system_id", data.id).order("created_at", { ascending: false });
    const { data: transfers } = await context.supabase
      .from("system_transfers").select("*").eq("system_id", data.id).order("created_at", { ascending: false });
    const { data: children } = await context.supabase
      .from("systems").select("id, system_code, name, status, assigned_agent_id, created_at")
      .eq("parent_system_id", data.id).order("created_at", { ascending: true });
    const { data: activity } = await context.supabase
      .from("system_activity_log").select("*").eq("system_id", data.id)
      .order("created_at", { ascending: false }).limit(300);
    const { data: profiles } = await context.supabase.from("profiles").select("id, display_name");

    let parent: { id: string; system_code: string; name: string } | null = null;
    if (sys.parent_system_id) {
      const { data: p } = await context.supabase
        .from("systems").select("id, system_code, name").eq("id", sys.parent_system_id).maybeSingle();
      parent = p ?? null;
    }
    const pmap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
    return {
      system: { ...sys, agent_name: sys.assigned_agent_id ? pmap.get(sys.assigned_agent_id) ?? null : null },
      parent,
      children: children ?? [],
      notes: (notes ?? []).map((n) => ({ ...n, author_name: pmap.get(n.author_id ?? "") ?? "לא ידוע" })),
      transfers: (transfers ?? []).map((t) => ({
        ...t,
        from_name: t.from_agent_id ? pmap.get(t.from_agent_id) ?? "לא ידוע" : "לא משויך",
        to_name: t.to_agent_id ? pmap.get(t.to_agent_id) ?? "לא ידוע" : "לא משויך",
        by_name: t.transferred_by ? pmap.get(t.transferred_by) ?? "לא ידוע" : "מערכת",
      })),
      activity: (activity ?? []).map((a) => ({
        ...a,
        actor_name: a.actor_id ? pmap.get(a.actor_id) ?? "לא ידוע" : "מערכת",
        old_agent_name: a.field === "assigned_agent_id" && a.old_value ? pmap.get(a.old_value) ?? null : null,
        new_agent_name: a.field === "assigned_agent_id" && a.new_value ? pmap.get(a.new_value) ?? null : null,
      })),
      profiles: profiles ?? [],
    };
  });

export const addSubSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { parent_id: string; system_code: string; name?: string }) =>
    z.object({
      parent_id: z.string().uuid(),
      system_code: z.string().min(1).max(60),
      name: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: parent } = await context.supabase
      .from("systems").select("id, name, assigned_agent_