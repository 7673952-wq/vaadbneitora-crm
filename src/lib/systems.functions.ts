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

async function isAdminUser(context: { supabase: any; userId: string }) {
  const { isAdminUserId } = await import("@/lib/admin-role.server");
  return isAdminUserId(context.userId);
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
      activity: (activity ?? []).map((a: any) => ({
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
  .inputValidator((d: { parent_id: string; system_code: string; name?: string; source?: string; caller_phone?: string }) =>
    z.object({
      parent_id: z.string().uuid(),
      system_code: z.string().min(1).max(60),
      name: z.string().max(200).optional(),
      source: z.string().max(40).optional(),
      caller_phone: z.string().max(40).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: parent, error: pe } = await context.supabase
      .from("systems").select("id, name, assigned_agent_id, parent_system_id").eq("id", data.parent_id).maybeSingle();
    if (pe) throw new Error(pe.message);
    if (!parent) throw new Error("מערכת אב לא נמצאה");
    if (parent.parent_system_id) throw new Error("לא ניתן להוסיף תת-מערכת בתוך תת-מערכת");

    const isAdmin = await isAdminUser(context);
    if (!isAdmin && parent.assigned_agent_id !== context.userId) {
      throw new Error("רק מנהל או הנציג המטפל יכולים להוסיף תת-מערכת");
    }
    const { data: row, error } = await context.supabase.from("systems").insert({
      system_code: data.system_code,
      name: data.name?.trim() || parent.name,
      parent_system_id: data.parent_id,
      status: "open",
      source: data.source ?? null,
      caller_phone: data.caller_phone ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    system_code: string; name: string; status: string;
    assigned_agent_id?: string | null; notes?: string; phone?: string;
    source?: string; caller_phone?: string; email?: string;
  }) =>
    z.object({
      system_code: z.string().min(1).max(60),
      name: z.string().min(1).max(200),
      status: statusSchema,
      assigned_agent_id: z.string().uuid().nullable().optional(),
      notes: z.string().max(2000).optional(),
      phone: z.string().max(60).optional(),
      source: z.string().max(40).optional(),
      caller_phone: z.string().max(40).optional(),
      email: z.string().email().max(200).optional().or(z.literal("")),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const isAdmin = await isAdminUser(context);
    if (!isAdmin) throw new Error("רק מנהל יכול להוסיף מערכות");
    const { data: existing } = await context.supabase
      .from("systems").select("id").eq("system_code", data.system_code).maybeSingle();
    if (existing) throw new Error("מספר המערכת כבר קיים — לא ניתן לפתוח מערכת חדשה על מספר קיים");
    // Auto-assign the creator as the handling agent if none was selected.
    const assignedAgentId = data.assigned_agent_id ?? context.userId;
    const { data: row, error } = await context.supabase.from("systems").insert({
      system_code: data.system_code,
      name: data.name,
      status: data.status,
      assigned_agent_id: assignedAgentId,
      notes: data.notes ?? null,
      phone: data.phone || null,
      source: data.source,
      caller_phone: data.caller_phone,
      email: data.email || null,
    } as any).select().single();
    if (error) throw new Error(error.message);
    return row;
  });


export const updateSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string; status?: string; assigned_agent_id?: string | null;
    name?: string; system_code?: string; notes?: string; phone?: string | null;
    caller_phone?: string | null; source?: string | null; audio_url?: string | null;
    reminder_at?: string | null; reminder_agent_ids?: string[] | null;
    reason?: string;
  }) =>
    z.object({
      id: z.string().uuid(),
      status: statusSchema.optional(),
      assigned_agent_id: z.string().uuid().nullable().optional(),
      name: z.string().min(1).max(200).optional(),
      system_code: z.string().min(1).max(60).optional(),
      notes: z.string().max(2000).optional(),
      phone: z.string().max(60).nullable().optional(),
      caller_phone: z.string().max(60).nullable().optional(),
      source: z.string().max(40).nullable().optional(),
      audio_url: z.string().url().max(500).nullable().optional(),
      reminder_at: z.string().datetime().nullable().optional(),
      reminder_agent_ids: z.array(z.string().uuid()).nullable().optional(),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: sys } = await context.supabase
      .from("systems")
      .select("id, assigned_agent_id, status, parent_system_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!sys) throw new Error("מערכת לא נמצאה");
    const isAdmin = await isAdminUser(context);
    if (!isAdmin && sys.assigned_agent_id !== context.userId) {
      throw new Error("רק מנהל או הנציג המטפל יכולים לעדכן");
    }
    if (data.system_code !== undefined && !isAdmin) {
      throw new Error("רק מנהל יכול לשנות את מזהה המערכת");
    }
    const statusLogTargets: Array<{ id: string; oldStatus: string; newStatus: string }> = [];
    if (data.status && data.status !== sys.status) {
      statusLogTargets.push({ id: data.id, oldStatus: sys.status, newStatus: data.status });
      if (!sys.parent_system_id) {
        const { data: children } = await context.supabase
          .from("systems")
          .select("id, status")
          .eq("parent_system_id", data.id)
          .neq("status", data.status);
        statusLogTargets.push(...(children ?? []).map((child: any) => ({
          id: child.id,
          oldStatus: child.status,
          newStatus: data.status!,
        })));
      }
    }
    const { id, reason: _r, ...patch } = data;
    const { data: row, error } = await context.supabase.from("systems").update(patch).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    // Attach the supplied status-change reason directly to the exact status log
    // rows created by the trigger, including child systems updated by propagation.
    if (data.reason && data.reason.trim() && statusLogTargets.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const logs = await Promise.all(statusLogTargets.map((target) => supabaseAdmin
        .from("system_activity_log")
        .select("id")
        .eq("system_id", target.id)
        .eq("field", "status")
        .eq("old_value", target.oldStatus)
        .eq("new_value", target.newStatus)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()));
      const logIds = logs.map((result) => result.data?.id).filter(Boolean) as string[];
      if (logIds.length) {
        await supabaseAdmin
          .from("system_activity_log")
          .update({ reason: data.reason.trim() })
          .in("id", logIds);
      }
    }
    return row;
  });

export const transferAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; to_agent_id: string | null; reason?: string }) =>
    z.object({
      id: z.string().uuid(),
      to_agent_id: z.string().uuid().nullable(),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const isAdmin = await isAdminUser(context);
    const { data: sys } = await context.supabase.from("systems").select("assigned_agent_id").eq("id", data.id).maybeSingle();
    if (!sys) throw new Error("מערכת לא נמצאה");
    if (!isAdmin && sys.assigned_agent_id !== context.userId) throw new Error("רק מנהל או הנציג הנוכחי יכולים להעביר");
    const startedAt = new Date().toISOString();
    const { error } = await context.supabase.from("systems").update({ assigned_agent_id: data.to_agent_id }).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (data.reason && data.reason.trim()) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("system_activity_log")
        .update({ reason: data.reason.trim() })
        .eq("system_id", data.id)
        .gte("created_at", startedAt)
        .is("reason", null);
      await supabaseAdmin
        .from("system_transfers")
        .update({ reason: data.reason.trim() })
        .eq("system_id", data.id)
        .gte("created_at", startedAt)
        .is("reason", null);
    }
    return { ok: true };
  });

export const deleteSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const isAdmin = await isAdminUser(context);
    if (!isAdmin) throw new Error("רק מנהל יכול למחוק מערכת");
    const { error } = await context.supabase.from("systems").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateActivityLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason?: string | null; old_value?: string | null; new_value?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      reason: z.string().max(500).nullable().optional(),
      old_value: z.string().max(500).nullable().optional(),
      new_value: z.string().max(500).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const isAdmin = await isAdminUser(context);
    if (!isAdmin) throw new Error("רק מנהל יכול לערוך יומן שינויים");
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("system_activity_log").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteActivityLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const isAdmin = await isAdminUser(context);
    if (!isAdmin) throw new Error("רק מנהל יכול למחוק שורת יומן");
    const { error } = await context.supabase.from("system_activity_log").delete().eq("id", data.id);
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

export const setReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string; repeat?: string; custom_date?: string | null; agent_ids?: string[] }) =>
    z.object({
      system_id: z.string().uuid(),
      repeat: z.enum(REPEAT_VALUES).optional(),
      custom_date: z.string().datetime().nullable().optional(),
      agent_ids: z.array(z.string().uuid()).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let when: Date | null = null;
    if (data.repeat === "custom") {
      if (!data.custom_date) throw new Error("יש לבחור תאריך");
      when = new Date(data.custom_date);
    } else if (data.repeat) {
      when = new Date();
      switch (data.repeat) {
        case "day": when.setDate(when.getDate() + 1); break;
        case "week": when.setDate(when.getDate() + 7); break;
        case "month": when.setMonth(when.getMonth() + 1); break;
        case "2months": when.setMonth(when.getMonth() + 2); break;
        case "year": when.setFullYear(when.getFullYear() + 1); break;
      }
    }
    const { error } = await context.supabase
      .from("systems")
      .update({
        reminder_at: when ? when.toISOString() : null,
        reminder_agent_ids: data.agent_ids ?? [],
      })
      .eq("id", data.system_id);
    if (error) throw new Error(error.message);
    return { ok: true, reminder_at: when?.toISOString() ?? null };
  });

export const dismissReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string }) => z.object({ system_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("systems")
      .update({ reminder_at: null, reminder_agent_ids: [] })
      .eq("id", data.system_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDueReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const nowIso = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("systems")
      .select("id, system_code, name, reminder_at, reminder_agent_ids")
      .not("reminder_at", "is", null)
      .lte("reminder_at", nowIso)
      .order("reminder_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);
    // filter by agent targeting
    return (data ?? []).filter((r: any) => {
      const ids: string[] = r.reminder_agent_ids ?? [];
      return ids.length === 0 || ids.includes(context.userId);
    });
  });

export const listWeeklyCrmReportRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await isAdminUser(context);
    if (!isAdmin) throw new Error("רק מנהל יכול לצפות ברשימת נמענים");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw new Error(error.message);
    return (data.users ?? []).map((u: any) => ({ id: u.id, email: u.email })).filter((u: any) => !!u.email);
  });

export const setParent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; parent_system_id: string | null }) =>
    z.object({ id: z.string().uuid(), parent_system_id: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const isAdmin = await isAdminUser(context);
    if (!isAdmin) throw new Error("רק מנהל יכול לשנות יחס מערכת/תת-מערכת");
    if (data.parent_system_id === data.id) throw new Error("מערכת לא יכולה להיות אב של עצמה");
    if (data.parent_system_id) {
      const { data: parent } = await context.supabase
        .from("systems").select("id, parent_system_id").eq("id", data.parent_system_id).maybeSingle();
      if (!parent) throw new Error("מערכת אב לא נמצאה");
      if (parent.parent_system_id) throw new Error("לא ניתן להפוך מערכת לתת-מערכת של תת-מערכת");
      const { count } = await context.supabase
        .from("systems").select("id", { count: "exact", head: true }).eq("parent_system_id", data.id);
      if ((count ?? 0) > 0) throw new Error("לא ניתן להפוך מערכת בעלת תתי-מערכות לתת-מערכת");
    }
    const { data: row, error } = await context.supabase
      .from("systems").update({ parent_system_id: data.parent_system_id }).eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profiles } = await context.supabase
      .from("profiles").select("id, display_name");
    return (profiles ?? []).map((p) => ({ id: p.id, display_name: p.display_name }));
  });

export const listMainSystems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("systems")
      .select("id, system_code, name")
      .is("parent_system_id", null)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const findSystemByName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string }) => z.object({ name: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("systems")
      .select("id, system_code, name, parent_system_id")
      .ilike("name", `%${data.name}%`)
      .order("name", { ascending: true })
      .limit(20);
    return rows ?? [];
  });

export const findSystemByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string }) => z.object({ code: z.string().min(1).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("systems")
      .select("id, system_code, name, status, parent_system_id, assigned_agent_id")
      .eq("system_code", data.code)
      .maybeSingle();
    return row ?? null;
  });

