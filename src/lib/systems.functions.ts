import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUS_VALUES = [
  "pending_check_close",
  "pending_check_open",
  "open",
  "closed",
  "problem",
  "open_only_bimot",
  "close_only_bimot",
  "open_in_simahedrin",
  "close_in_simahedrin",
  "send_to_yosela",
  "block_from_root",
] as const;

const statusSchema = z.enum(STATUS_VALUES);

export const listSystems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string | null; agentId?: string | null; period?: string | null }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("systems")
      .select("id, system_code, name, status, assigned_agent_id, notes, created_at, updated_at")
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

    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, display_name");

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (rows ?? []).map((r) => ({
      ...r,
      agent: r.assigned_agent_id ? profileMap.get(r.assigned_agent_id) ?? null : null,
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
    const { data: profiles } = await context.supabase.from("profiles").select("id, display_name");

    const pmap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
    return {
      system: { ...sys, agent_name: sys.assigned_agent_id ? pmap.get(sys.assigned_agent_id) ?? null : null },
      children: children ?? [],
      notes: (notes ?? []).map((n) => ({ ...n, author_name: pmap.get(n.author_id ?? "") ?? "לא ידוע" })),
      transfers: (transfers ?? []).map((t) => ({
        ...t,
        from_name: t.from_agent_id ? pmap.get(t.from_agent_id) ?? "לא ידוע" : "לא משויך",
        to_name: t.to_agent_id ? pmap.get(t.to_agent_id) ?? "לא ידוע" : "לא משויך",
        by_name: t.transferred_by ? pmap.get(t.transferred_by) ?? "לא ידוע" : "מערכת",
      })),
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
    const { data: parent, error: pe } = await context.supabase
      .from("systems").select("id, name, assigned_agent_id").eq("id", data.parent_id).maybeSingle();
    if (pe) throw new Error(pe.message);
    if (!parent) throw new Error("מערכת אב לא נמצאה");

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin && parent.assigned_agent_id !== context.userId) {
      throw new Error("רק מנהל או הנציג המטפל יכולים להוסיף תת-מערכת");
    }

    const { data: row, error } = await context.supabase.from("systems").insert({
      system_code: data.system_code,
      name: data.name?.trim() || parent.name,
      parent_system_id: data.parent_id,
      status: "open",
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_code: string; name: string; status: string; assigned_agent_id?: string | null; notes?: string }) =>
    z.object({
      system_code: z.string().min(1).max(60),
      name: z.string().min(1).max(200),
      status: statusSchema,
      assigned_agent_id: z.string().uuid().nullable().optional(),
      notes: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("רק מנהל יכול להוסיף מערכות");
    const { data: row, error } = await context.supabase.from("systems").insert({
      system_code: data.system_code,
      name: data.name,
      status: data.status,
      assigned_agent_id: data.assigned_agent_id ?? null,
      notes: data.notes ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status?: string; assigned_agent_id?: string | null; name?: string; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: statusSchema.optional(),
      assigned_agent_id: z.string().uuid().nullable().optional(),
      name: z.string().min(1).max(200).optional(),
      notes: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase.from("systems").update(patch).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("systems").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string; body: string }) =>
    z.object({ system_id: z.string().uuid(), body: z.string().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("system_notes").insert({
      system_id: data.system_id, body: data.body, author_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, display_name");
    return (profiles ?? []).map((p) => ({
      id: p.id,
      display_name: p.display_name,
    }));
  });
