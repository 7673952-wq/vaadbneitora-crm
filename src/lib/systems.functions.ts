import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { sanitizeText, sanitizeOptional } from "@/lib/sanitize";
import { readStatusSettings } from "@/lib/status-settings";

// If a system_code doesn't already start with "0" or "972", and has
// fewer than 10 digits, prepend "0" automatically (e.g. "512345678" ->
// "0512345678"). Codes that already start with 0/972, or that have
// 10+ digits, are left untouched.
function normalizeSystemCode(code: string): string {
  const trimmed = code.trim();
  if (trimmed.startsWith("0") || trimmed.startsWith("972")) return trimmed;
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 10) return trimmed;
  return "0" + trimmed;
}

const STATUS_VALUES = [
  "pending_check_close", "pending_check_open", "open", "to_open", "closed",
  "to_block", "block_from_root", "problem", "open_only_bimot", "close_only_bimot",
  "open_in_simahedrin", "close_in_simahedrin", "send_to_yosela",
  "sent_to_yosela", "blocked_from_root", "send_to_committee",
  "sent_to_committee", "blocked_in_committee",
] as const;
const statusSchema = z.enum(STATUS_VALUES);
const REPEAT_VALUES = ["day", "week", "month", "2months", "year", "custom"] as const;

// All authorization in this file goes through `assertRole` / `hasRole`
// from @/lib/permissions.server — single source of truth.
async function userHasRole(userId: string, role: "agent" | "admin" | "super_admin") {
  const { hasRole } = await import("@/lib/permissions.server");
  return hasRole(userId, role);
}
// Read-only viewers cannot mutate anything — call at the top of every write handler.
async function ensureCanWrite(userId: string) {
  const { assertCanWrite } = await import("@/lib/permissions.server");
  await assertCanWrite(userId);
}


const periodSchema = z.enum(["day", "week", "month", "year"]);
const isoDate = z.string().datetime().or(z.string().min(4)).nullable().optional();
const listSystemsInputSchema = z.object({
  status: statusSchema.nullable().optional(),
  secondaryStatus: statusSchema.nullable().optional(),
  agentId: z.string().uuid().nullable().optional(),
  period: periodSchema.nullable().optional(),
  dateFrom: isoDate,
  dateTo: isoDate,
  page: z.number().int().min(1).max(10000).optional(),
  pageSize: z.number().int().min(1).max(100000).optional(),
}).strict();

export const listSystems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSystemsInputSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    checkRateLimit(`${context.userId}:listSystems`, 30, 60_000);
    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 1000;
    const offset = (page - 1) * pageSize;
    const endTo = offset + pageSize - 1;

    const baseSelect =
      "id, system_code, name, status, secondary_status, assigned_agent_id, notes, phone, caller_phone, source, reminder_at, reminder_agent_ids, handled_pending_at, parent_system_id, audio_url, created_at, updated_at";

    const applySharedFilters = (q: any) => {
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
      if (data.dateFrom) q = q.gte("updated_at", new Date(data.dateFrom).toISOString());
      if (data.dateTo) q = q.lte("updated_at", new Date(data.dateTo).toISOString());
      return q;
    };

    // Optional/workflow statuses can live either in `secondary_status` or, for
    // older rows, directly in `status`. Fetch both paths separately and merge;
    // this avoids PostgREST edge cases when OR-ing enum and text columns.
    if (data.secondaryStatus) {
      const fetchByColumn = async (column: "status" | "secondary_status") => {
        if (data.status && column === "status" && data.status !== data.secondaryStatus) return [];
        const rows: any[] = [];
        const CHUNK = 1000;
        for (let from = 0; ; from += CHUNK) {
          let q = context.supabase
            .from("systems")
            .select(baseSelect)
            .eq(column, data.secondaryStatus as any);
          if (data.status && column !== "status") q = q.eq("status", data.status as any);
          q = applySharedFilters(q).order("updated_at", { ascending: false }).range(from, from + CHUNK - 1);
          const { data: got, error } = await q;
          if (error) throw new Error(error.message);
          rows.push(...(got ?? []));
          if (!got || got.length < CHUNK) break;
        }
        return rows;
      };

      const merged = new Map<string, any>();
      for (const row of [...await fetchByColumn("secondary_status"), ...await fetchByColumn("status")]) {
        merged.set(row.id, row);
      }
      const allRows = Array.from(merged.values()).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      const items = await enrichSystemRows(context.supabase, allRows.slice(offset, endTo + 1));
      return { items, total: allRows.length, page, pageSize };
    }

    const buildQuery = (from: number, to: number, withCount: boolean) => {
      let q = context.supabase
        .from("systems")
        .select(baseSelect, withCount ? { count: "exact" } : {});
      if (data.status) q = q.eq("status", data.status as any);
      return applySharedFilters(q).order("updated_at", { ascending: false }).range(from, to);
    };

    // PostgREST caps a single response at ~1000 rows. When the caller asks
    // for more (e.g. "All" in the dashboard, or a full export), fetch the
    // window in 1000-row chunks so we return everything requested.
    const CHUNK = 1000;
    const allRows: any[] = [];
    let total = 0;
    let first = true;
    for (let from = offset; from <= endTo; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, endTo);
      const { data: rows, error, count } = await buildQuery(from, to, first);
      if (error) throw new Error(error.message);
      if (first && typeof count === "number") total = count;
      first = false;
      const got = rows ?? [];
      allRows.push(...got);
      if (got.length < to - from + 1) break;
    }
    const items = await enrichSystemRows(context.supabase, allRows);
    return { items, total: total || items.length, page, pageSize };
  });

// Global per-status counts across ALL systems (with optional agent/period
// filters), independent of dashboard pagination.
export const getStatusCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      agentId: z.string().uuid().nullable().optional(),
      period: periodSchema.nullable().optional(),
      dateFrom: isoDate,
      dateTo: isoDate,
    }).strict().parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("systems").select("status, secondary_status");
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
    if (data.dateFrom) q = q.gte("updated_at", new Date(data.dateFrom).toISOString());
    if (data.dateTo) q = q.lte("updated_at", new Date(data.dateTo).toISOString());
    // Paginate through everything to bypass the 1000-row default.
    const primary: Record<string, number> = {};
    const secondary: Record<string, number> = {};
    const any: Record<string, number> = {};
    const pageSize = 1000;
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: rows, error } = await q.range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      for (const r of rows as any[]) {
        if (r.status) primary[r.status] = (primary[r.status] ?? 0) + 1;
        if (r.secondary_status) secondary[r.secondary_status] = (secondary[r.secondary_status] ?? 0) + 1;
        for (const key of new Set([r.status, r.secondary_status].filter(Boolean))) {
          any[key as string] = (any[key as string] ?? 0) + 1;
        }
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    // Back-compat: spread primary at top-level so old callers keep working.
    return { ...primary, primary, secondary, any };
  });



// Adds `agent` and `parent` lookup blobs onto raw system rows so the UI
// can render them without an N+1.
async function enrichSystemRows(supabase: any, rows: any[]) {
  if (!rows.length) return [];
  const { data: profiles } = await supabase.from("profiles").select("id, display_name");
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  const parentIds = Array.from(new Set(rows.map((r) => r.parent_system_id).filter(Boolean) as string[]));
  let parentMap = new Map<string, { id: string; system_code: string; name: string }>();
  if (parentIds.length) {
    const { data: parents } = await supabase
      .from("systems").select("id, system_code, name").in("id", parentIds);
    parentMap = new Map((parents ?? []).map((p: any) => [p.id, p]));
  }
  return rows.map((r) => ({
    ...r,
    agent: r.assigned_agent_id ? profileMap.get(r.assigned_agent_id) ?? null : null,
    parent: r.parent_system_id ? parentMap.get(r.parent_system_id) ?? null : null,
  }));
}

export const getSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sys, error } = await context.supabase
      .from("systems").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sys) throw new Error("מערכת לא נמצאה");

    const [notesRes, transfersRes, childrenRes, activityRes, profilesRes, parentRes] = await Promise.all([
      context.supabase.from("system_notes").select("*").eq("system_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("system_transfers").select("*").eq("system_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("systems").select("id, system_code, name, status, assigned_agent_id, created_at")
        .eq("parent_system_id", data.id).order("created_at", { ascending: true }),
      context.supabase.from("system_activity_log").select("*").eq("system_id", data.id)
        .order("created_at", { ascending: false }).limit(300),
      context.supabase.from("profiles").select("id, display_name"),
      sys.parent_system_id
        ? context.supabase.from("systems").select("id, system_code, name").eq("id", sys.parent_system_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const notes = notesRes.data;
    const transfers = transfersRes.data;
    const children = childrenRes.data;
    const activity = activityRes.data;
    const profiles = profilesRes.data;
    const parent = (parentRes.data as { id: string; system_code: string; name: string } | null) ?? null;

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
      activity: await (async () => {
        const parentIds = Array.from(new Set((activity ?? [])
          .filter((a: any) => a.field === "parent_system_id")
          .flatMap((a: any) => [a.old_value, a.new_value])
          .filter(Boolean) as string[]));
        let parentNameMap = new Map<string, string>();
        if (parentIds.length) {
          const { data: ps } = await context.supabase.from("systems")
            .select("id, system_code, name").in("id", parentIds);
          parentNameMap = new Map((ps ?? []).map((p: any) => [p.id, `${p.system_code} / ${p.name ?? ""}`.trim().replace(/\/\s*$/, "")]));
        }
        return (activity ?? []).map((a: any) => ({
          ...a,
          actor_name: a.actor_display_name ?? (a.actor_id ? pmap.get(a.actor_id) ?? "לא ידוע" : "מערכת"),
          old_agent_name: a.field === "assigned_agent_id" && a.old_value ? pmap.get(a.old_value) ?? null : null,
          new_agent_name: a.field === "assigned_agent_id" && a.new_value ? pmap.get(a.new_value) ?? null : null,
          old_parent_name: a.field === "parent_system_id" && a.old_value ? parentNameMap.get(a.old_value) ?? null : null,
          new_parent_name: a.field === "parent_system_id" && a.new_value ? parentNameMap.get(a.new_value) ?? null : null,
        }));
      })(),
      profiles: profiles ?? [],
    };
  });

export const addSubSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    parent_id: string; system_code: string; name?: string; status?: string;
    notes?: string; phone?: string; source?: string; caller_phone?: string; email?: string;
  }) =>
    z.object({
      parent_id: z.string().uuid(),
      system_code: z.string().min(1).max(60),
      name: z.string().max(200).optional(),
      status: statusSchema.optional(),
      notes: z.string().max(2000).optional(),
      phone: z.string().max(60).optional(),
      source: z.string().max(40).optional(),
      caller_phone: z.string().max(40).optional(),
      email: z.string().email().max(200).optional().or(z.literal("")),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    // Walk up the chain to the top-most root: if the caller passed a
    // sub-system id (legacy/broken data or a stale parent picked from the
    // duplicate-name suggestion), silently resolve to its root instead of
    // failing. Guarded against cycles by a depth cap.
    let parent: { id: string; name: string; assigned_agent_id: string | null; parent_system_id: string | null } | null = null;
    let currentId: string | null = data.parent_id;
    for (let hop = 0; hop < 10 && currentId; hop++) {
      const res: any = await context.supabase
        .from("systems").select("id, name, assigned_agent_id, parent_system_id").eq("id", currentId).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      const node = res.data as { id: string; name: string; assigned_agent_id: string | null; parent_system_id: string | null } | null;
      if (!node) break;
      parent = node;
      if (!node.parent_system_id) break;
      currentId = node.parent_system_id;
    }
    if (!parent) throw new Error("מערכת אב לא נמצאה");

    const isAdmin = await userHasRole(context.userId, "admin");
    if (!isAdmin && parent.assigned_agent_id !== context.userId) {
      throw new Error("רק מנהל או הנציג המטפל יכולים להוסיף תת-מערכת");
    }
    const cleanSubNotes = sanitizeOptional(data.notes ?? null);
    const { data: inserted, error } = await context.supabase.from("systems").insert({
      system_code: normalizeSystemCode(data.system_code),
      name: sanitizeText(data.name?.trim() || parent.name || ""),
      status: data.status ?? "open",
      assigned_agent_id: parent.assigned_agent_id,
      notes: cleanSubNotes,
      phone: sanitizeOptional(data.phone ?? null),
      source: sanitizeOptional(data.source ?? null),
      caller_phone: sanitizeOptional(data.caller_phone ?? null),
      email: data.email || null,
    }).select().single();
    if (error) throw new Error(error.message);
    const { data: row, error: parentError } = await context.supabase
      .from("systems")
      .update({ parent_system_id: parent.id })
      .eq("id", inserted.id)
      .select()
      .single();
    if (parentError) {
      await context.supabase.from("systems").delete().eq("id", inserted.id);
      throw new Error(parentError.message);
    }
    if (cleanSubNotes && row?.id) {
      try {
        await context.supabase.from("system_notes").insert({
          system_id: row.id, body: cleanSubNotes, author_id: context.userId,
        });
      } catch { /* non-fatal */ }
    }
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
    await ensureCanWrite(context.userId);
    const allowed = await userHasRole(context.userId, "agent");
    if (!allowed) throw new Error("רק נציג ומעלה יכול לפתוח מערכת");
    const normalizedCode = normalizeSystemCode(data.system_code);
    const { data: existing } = await context.supabase
      .from("systems").select("id").eq("system_code", normalizedCode).maybeSingle();
    if (existing) throw new Error("מספר המערכת כבר קיים — לא ניתן לפתוח מערכת חדשה על מספר קיים");
    // Auto-assign the creator as the handling agent if none was selected.
    const assignedAgentId = data.assigned_agent_id ?? context.userId;
    const cleanNotes = sanitizeOptional(data.notes ?? null);
    const { data: row, error } = await context.supabase.from("systems").insert({
      system_code: normalizedCode,
      name: sanitizeText(data.name),
      status: data.status,
      assigned_agent_id: assignedAgentId,
      notes: cleanNotes,
      phone: sanitizeOptional(data.phone || null),
      source: sanitizeOptional(data.source ?? null),
      caller_phone: sanitizeOptional(data.caller_phone ?? null),
      email: data.email || null,
    } as any).select().single();
    if (error) throw new Error(error.message);
    if (cleanNotes && row?.id) {
      try {
        await context.supabase.from("system_notes").insert({
          system_id: row.id, body: cleanNotes, author_id: context.userId,
        });
      } catch { /* non-fatal — the mirror in system_notes is best-effort */ }
    }
    return row;
  });


export const updateSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string; status?: string; secondary_status?: string | null; assigned_agent_id?: string | null;
    name?: string; system_code?: string; notes?: string; phone?: string | null;
    caller_phone?: string | null; source?: string | null; audio_url?: string | null;
    reminder_at?: string | null; reminder_agent_ids?: string[] | null;
    email?: string | null;
    reason?: string;
  }) =>
    z.object({
      id: z.string().uuid(),
      status: statusSchema.optional(),
      secondary_status: statusSchema.nullable().optional(),
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
      email: z.string().email().max(200).nullable().optional().or(z.literal("")),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    checkRateLimit(`${context.userId}:updateSystem`, 60, 60_000);
    // Sanitize free-text fields prior to any DB write.
    if (data.name !== undefined) data.name = sanitizeText(data.name);
    if (data.notes !== undefined) data.notes = sanitizeText(data.notes);
    if (data.phone !== undefined && data.phone !== null) data.phone = sanitizeText(data.phone);
    if (data.caller_phone !== undefined && data.caller_phone !== null) data.caller_phone = sanitizeText(data.caller_phone);
    if (data.source !== undefined && data.source !== null) data.source = sanitizeText(data.source);
    if (data.system_code !== undefined) data.system_code = normalizeSystemCode(data.system_code);
    const { data: sys } = await context.supabase
      .from("systems")
      .select("id, assigned_agent_id, status, parent_system_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!sys) throw new Error("מערכת לא נמצאה");
    const isAdmin = await userHasRole(context.userId, "admin");
    if (!isAdmin && sys.assigned_agent_id !== context.userId) {
      throw new Error("רק מנהל או הנציג המטפל יכולים לעדכן");
    }
    let isSuper: boolean | null = null;
    const checkSuper = async () => {
      if (isSuper === null) isSuper = await userHasRole(context.userId, "super_admin");
      return isSuper;
    };
    if (data.system_code !== undefined && !(await checkSuper())) {
      throw new Error("רק מנהל ראשי יכול לשנות את מזהה המערכת");
    }
    if (data.name !== undefined && !isAdmin && !(await checkSuper())) {
  throw new Error("רק מנהל יכול לשנות את שם המערכת");
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

    // Auto-assign the configured agent for this status (if any and caller
    // didn't already pick one in the same request).
    if (data.status && data.status !== sys.status && data.assigned_agent_id === undefined) {
      const setting = (await readStatusSettings(context.supabase)).find((row) => row.status_key === data.status);
      const ids: string[] = setting?.assigned_agent_ids ?? [];
      if (ids.length > 0) {
        (data as any).assigned_agent_id = ids[0];
      }
    }

    const { id, reason: _r, email, ...patch } = data as any;
    if (email !== undefined) (patch as any).email = email || null;
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
    await ensureCanWrite(context.userId);
    const isAdmin = await userHasRole(context.userId, "admin");
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
  .inputValidator((d: { id: string; mode?: "cascade" | "promote"; promote_to_id?: string }) =>
    z.object({
      id: z.string().uuid(),
      mode: z.enum(["cascade", "promote"]).optional(),
      promote_to_id: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { assertRole } = await import("@/lib/permissions.server");
    await assertRole(context.userId, "super_admin");

    const mode = data.mode ?? "cascade";
    // "promote" — keep children alive: pick one as the new parent and
    // reparent its siblings to it, then delete the original parent
    // (CASCADE no longer reaches anyone because the children are detached).
    if (mode === "promote") {
      const { data: kids, error: kidsErr } = await context.supabase
        .from("systems")
        .select("id")
        .eq("parent_system_id", data.id);
      if (kidsErr) throw new Error(kidsErr.message);
      const childIds = (kids ?? []).map((k: any) => k.id);
      if (childIds.length === 0) throw new Error("אין תתי-מערכות לקידום — השתמש במחיקה רגילה");

      const newParent = data.promote_to_id && childIds.includes(data.promote_to_id)
        ? data.promote_to_id
        : childIds[0];

      // 1. Promote the chosen child to a main system.
      const { error: e1 } = await context.supabase
        .from("systems").update({ parent_system_id: null }).eq("id", newParent);
      if (e1) throw new Error(e1.message);

      // 2. Re-attach all remaining siblings under the new parent.
      const siblings = childIds.filter((cid) => cid !== newParent);
      if (siblings.length > 0) {
        const { error: e2 } = await context.supabase
          .from("systems").update({ parent_system_id: newParent }).in("id", siblings);
        if (e2) throw new Error(e2.message);
      }
    }

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
    await ensureCanWrite(context.userId);
    const isAdmin = await userHasRole(context.userId, "admin");
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
    await ensureCanWrite(context.userId);
    const isAdmin = await userHasRole(context.userId, "admin");
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
    await ensureCanWrite(context.userId);
    const { error } = await context.supabase.from("system_notes").insert({
      system_id: data.system_id, body: sanitizeText(data.body), author_id: context.userId,
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
    await ensureCanWrite(context.userId);
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
    await ensureCanWrite(context.userId);
    const { error } = await context.supabase
      .from("systems")
      .update({ reminder_at: null, reminder_agent_ids: [], reminder_handled: true, snoozed_until: null })
      .eq("id", data.system_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const snoozeReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string; minutes: number }) =>
    z.object({ system_id: z.string().uuid(), minutes: z.number().int().min(1).max(60 * 24 * 365) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const until = new Date(Date.now() + data.minutes * 60_000).toISOString();
    const { error } = await context.supabase
      .from("systems")
      .update({ snoozed_until: until })
      .eq("id", data.system_id);
    if (error) throw new Error(error.message);
    return { ok: true, snoozed_until: until };
  });

export const listDueReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const nowIso = new Date().toISOString();
    const { data: manual, error: e1 } = await context.supabase
      .from("systems")
      .select("id, system_code, name, status, reminder_at, reminder_agent_ids, snoozed_until")
      .not("reminder_at", "is", null)
      .lte("reminder_at", nowIso)
      .order("reminder_at", { ascending: true })
      .limit(200);
    if (e1) throw new Error(e1.message);

    const statuses = await readStatusSettings(context.supabase);
    const pendingStatusKeys = (statuses ?? [])
      .filter((s: any) => s.is_handled === false)
      .map((s: any) => s.status_key);
    const myWaitingStatuses = (statuses ?? [])
      .filter((s: any) => s.is_handled === false && Array.isArray(s.assigned_agent_ids) && s.assigned_agent_ids.includes(context.userId))
      .map((s: any) => s.status_key);

    let derived: any[] = [];
    if (myWaitingStatuses.length) {
      const { data: rows, error: e3 } = await context.supabase
        .from("systems")
        .select("id, system_code, name, status, reminder_at, reminder_agent_ids, reminder_handled, snoozed_until, updated_at")
        .in("status", myWaitingStatuses as any)
        .eq("reminder_handled", false)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (e3) throw new Error(e3.message);
      derived = rows ?? [];
    }

    // Stale: systems assigned to me, pending, untreated for >= threshold days
    let stale: any[] = [];
    const { data: settingRow } = await context.supabase
      .from("app_settings").select("value").eq("key", "auto_snooze").maybeSingle();
    const thresholdDays = Number((settingRow?.value as any)?.threshold_days ?? 0);
    if (thresholdDays > 0 && pendingStatusKeys.length) {
      const cutoff = new Date(Date.now() - thresholdDays * 86400_000).toISOString();
      const { data: rows, error: e4 } = await context.supabase
        .from("systems")
        .select("id, system_code, name, status, reminder_at, reminder_agent_ids, reminder_handled, snoozed_until, updated_at, assigned_agent_id")
        .eq("assigned_agent_id", context.userId)
        .in("status", pendingStatusKeys as any)
        .lt("updated_at", cutoff)
        .eq("reminder_handled", false)
        .order("updated_at", { ascending: true })
        .limit(500);
      if (e4) throw new Error(e4.message);
      stale = rows ?? [];
    }

    const now = Date.now();
    const notSnoozed = (r: any) => !r.snoozed_until || new Date(r.snoozed_until).getTime() <= now;

    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of (manual ?? [])) {
      if (!notSnoozed(r)) continue;
      const ids: string[] = r.reminder_agent_ids ?? [];
      if (ids.length === 0 || ids.includes(context.userId)) {
        if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, source: "manual" }); }
      }
    }
    for (const r of derived) {
      if (!notSnoozed(r)) continue;
      if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, source: "status" }); }
    }
    for (const r of stale) {
      if (!notSnoozed(r)) continue;
      if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, source: "stale" }); }
    }
    return out;
  });

export const listWeeklyCrmReportRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await userHasRole(context.userId, "admin");
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
    await ensureCanWrite(context.userId);
    const isAdmin = await userHasRole(context.userId, "admin");
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

export const detectMissingSystemSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      start: z.string().min(1).max(60),
      end: z.string().min(1).max(60),
      prefix: z.string().max(20).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const startNum = Number(String(data.start).replace(/\D/g, ""));
    const endNum = Number(String(data.end).replace(/\D/g, ""));
    if (!Number.isSafeInteger(startNum) || !Number.isSafeInteger(endNum) || endNum < startNum) {
      throw new Error("טווח מזהים לא תקין");
    }
    const count = endNum - startNum + 1;
    if (count > 5000) throw new Error("טווח גדול מדי — עד 5,000 מזהים בבדיקה אחת");

    const width = Math.max(String(data.start).replace(/\D/g, "").length, String(data.end).replace(/\D/g, "").length);
    const prefix = sanitizeOptional(data.prefix ?? "") ?? "";
    const wanted = Array.from({ length: count }, (_, i) => `${prefix}${String(startNum + i).padStart(width, "0")}`);

    const { data: rows, error } = await context.supabase
      .from("systems")
      .select("system_code")
      .in("system_code", wanted as any);
    if (error) throw new Error(error.message);

    const existingExact = new Set((rows ?? []).map((r: any) => String(r.system_code)));
    const missing = wanted.filter((code) => !existingExact.has(code));

    // Also catch equivalent phone-style codes that differ only by leading 0/972.
    if (missing.length > 0) {
      const { data: allRows, error: allErr } = await context.supabase
        .from("systems")
        .select("system_code")
        .limit(10000);
      if (allErr) throw new Error(allErr.message);
      const existingNormalized = new Set((allRows ?? [])
        .map((r: any) => String(r.system_code ?? "").replace(/\D/g, "").replace(/^972/, "").replace(/^0+/, ""))
        .filter(Boolean));
      const missingNormalized = missing.filter((code) => !existingNormalized.has(code.replace(/\D/g, "").replace(/^972/, "").replace(/^0+/, "")));
      return { missing: missingNormalized, total: count, existing: count - missingNormalized.length };
    }

    return { missing, total: count, existing: count - missing.length };
  });

export const createMissingSystems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      codes: z.array(z.string().min(1).max(60)).min(1).max(500),
      namePrefix: z.string().min(1).max(120).default("מערכת"),
      status: statusSchema.default("open"),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const isAdmin = await userHasRole(context.userId, "admin");
    if (!isAdmin) throw new Error("רק מנהל יכול להשלים סדרות מזהים");
    const rows = data.codes.map((code) => {
      const normalized = normalizeSystemCode(code);
      return {
        system_code: normalized,
        name: sanitizeText(`${data.namePrefix} ${normalized}`.trim()),
        status: data.status,
        assigned_agent_id: context.userId,
        notes: "נוצר אוטומטית מהשלמת סדרת מזהים",
      };
    });
    const { data: created, error } = await context.supabase
      .from("systems")
      .insert(rows)
      .select("id, system_code, name");
    if (error) throw new Error(error.message);
    return { createdCount: created?.length ?? 0 };
  });

export const findSystemByName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string }) => z.object({ name: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    // Two passes so a name shared by many sub-systems never buries the true
    // root parent below the row limit: first fetch any exact-name matches
    // (roots and subs), then top up with fuzzy ilike matches.
    const trimmed = data.name.trim();
    const [exactRes, fuzzyRes] = await Promise.all([
      context.supabase
        .from("systems")
        .select("id, system_code, name, parent_system_id, parent:systems!parent_system_id(id, system_code, name, parent_system_id)")
        .ilike("name", trimmed)
        .limit(50),
      context.supabase
        .from("systems")
        .select("id, system_code, name, parent_system_id, parent:systems!parent_system_id(id, system_code, name, parent_system_id)")
        .ilike("name", `%${trimmed}%`)
        .order("name", { ascending: true })
        .limit(20),
    ]);
    if (exactRes.error) throw new Error(exactRes.error.message);
    if (fuzzyRes.error) throw new Error(fuzzyRes.error.message);
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const r of [...(exactRes.data ?? []), ...(fuzzyRes.data ?? [])]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    return merged;
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


export const importSystems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rows: Array<Record<string, any>> }) =>
    z.object({
      rows: z.array(z.record(z.any())).min(1).max(2000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const isAdmin = await userHasRole(context.userId, "admin");
    if (!isAdmin) throw new Error("רק מנהל יכול לייבא מערכות");

    const statusSet = new Set<string>(STATUS_VALUES as readonly string[]);
    // Load label -> key map from the stable status settings config.
    const settings = await readStatusSettings(context.supabase);
    const labelToKey = new Map<string, string>();
    for (const s of (settings ?? []) as any[]) {
      if (s.label) labelToKey.set(String(s.label).trim(), s.status_key);
    }
    // Default labels fallback
    const DEFAULTS: Record<string, string> = {
      "לבדיקה לחסימה": "pending_check_close",
      "לבדיקה לפתיחה": "pending_check_open",
      "פתוח": "open", "לפתוח": "to_open", "חסום": "closed",
      "לחסום": "to_block", "לחסום מהשורש": "block_from_root", "בעיה": "problem",
      "לפתוח רק בימות": "open_only_bimot", "פתוח רק בימות": "close_only_bimot",
      "לפתיחה בסימהדרין": "open_in_simahedrin", "לחסימה בסימהדרין": "close_in_simahedrin",
      "לשלוח ליוסלה": "send_to_yosela",
      "נשלח ליוסלה": "sent_to_yosela",
      "נחסם מהשורש": "blocked_from_root",
      "לשלוח לועדה": "send_to_committee", "לשלוח לוועדה": "send_to_committee",
      "נשלח לועדה": "sent_to_committee", "נשלח לוועדה": "sent_to_committee",
      "נחסם בועדה": "blocked_in_committee", "נחסם בוועדה": "blocked_in_committee",
    };
    for (const [k, v] of Object.entries(DEFAULTS)) if (!labelToKey.has(k)) labelToKey.set(k, v);

    const resolveStatus = (v: any): string | null => {
      if (v == null) return null;
      const s = String(v).trim();
      if (!s) return null;
      if (statusSet.has(s)) return s;
      return labelToKey.get(s) ?? null;
    };

    // Load agents (id + display_name) for optional mapping
    const { data: profiles } = await context.supabase.from("profiles").select("id, display_name");
    const nameToAgent = new Map<string, string>();
    for (const p of (profiles ?? []) as any[]) {
      if (p.display_name) nameToAgent.set(String(p.display_name).trim(), p.id);
    }

    const created: any[] = [];
    const errors: { row: number; reason: string }[] = [];
    const incomplete: number[] = [];
    // Each conflict tells the client which row has a duplicate name and
    // lists the existing systems that share it, so the user can decide
    // whether to make the new row a root system or a sub-system of one
    // of the candidates.
    const conflicts: Array<{
      row: number;
      name: string;
      system_code: string;
      candidates: Array<{ id: string; system_code: string; name: string }>;
    }> = [];

    // Normalize phone-like codes: strip non-digits, then strip leading 0 / 972 / +972
    const normalizeCode = (v: string): string => {
      const digits = String(v).replace(/\D/g, "");
      if (!digits) return "";
      if (digits.startsWith("972")) return digits.slice(3).replace(/^0+/, "");
      if (digits.startsWith("0")) return digits.replace(/^0+/, "");
      return digits;
    };

    // Existing codes + names for duplicate/parent detection
    const { data: existingRows } = await context.supabase
      .from("systems").select("id, system_code, name, parent_system_id");
    const existingCodes = new Set<string>(((existingRows ?? []) as any[]).map((r) => String(r.system_code)));
    const existingNormalized = new Set<string>(
      ((existingRows ?? []) as any[])
        .map((r) => normalizeCode(String(r.system_code ?? "")))
        .filter(Boolean),
    );
    // Map name -> list of candidate systems (any depth) for conflict UI
    const nameToCandidates = new Map<string, Array<{ id: string; system_code: string; name: string }>>();
    for (const r of (existingRows ?? []) as any[]) {
      if (!r.name) continue;
      const key = String(r.name).trim();
      if (!key) continue;
      const arr = nameToCandidates.get(key) ?? [];
      arr.push({ id: r.id, system_code: r.system_code, name: r.name });
      nameToCandidates.set(key, arr);
    }

    const seenInBatch = new Set<string>();
    const seenNormalizedInBatch = new Set<string>();

    const pick = (r: Record<string, any>, keys: string[]) => {
      for (const k of keys) {
        if (r[k] != null && String(r[k]).trim() !== "") return String(r[k]).trim();
      }
      return "";
    };

    for (let i = 0; i < data.rows.length; i++) {
      const r = data.rows[i];
      const rowNum = i + 2; // header is row 1
      const system_code = pick(r, ["מספר מערכת", "system_code", "מספר", "מזהה מערכת"]);
      const name = pick(r, ["שם מערכת", "שם המערכת", "name", "שם"]);
      const statusRaw = pick(r, ["סטטוס", "status"]);
      const status = resolveStatus(statusRaw);

      // Per-row relation decision from a prior conflict-resolution round.
      // The client sends `__relation` ("root" | "sub") and optionally
      // `__parent_id` for "sub" choices. Rows without these fields go
      // through normal conflict detection.
      const relation = (r as any).__relation === "root" || (r as any).__relation === "sub"
        ? (r as any).__relation as "root" | "sub" : null;
      const parentIdOverride = typeof (r as any).__parent_id === "string"
        ? String((r as any).__parent_id) : null;

      if (!system_code || !name || !status) {
        const missing: string[] = [];
        if (!system_code) missing.push("מספר מערכת");
        if (!name) missing.push("שם מערכת");
        if (!status) missing.push(statusRaw ? `סטטוס ('${statusRaw}' לא מזוהה)` : "סטטוס");
        errors.push({ row: rowNum, reason: `חסר/לא תקין: ${missing.join(", ")}` });
        continue;
      }
      const normalizedCode = normalizeCode(system_code);
      if (
        existingCodes.has(system_code) ||
        seenInBatch.has(system_code) ||
        (normalizedCode && (existingNormalized.has(normalizedCode) || seenNormalizedInBatch.has(normalizedCode)))
      ) {
        errors.push({ row: rowNum, reason: `המספר קיים ('${system_code}')` });
        continue;
      }

      // Name-conflict detection: if a system with this name already exists
      // and the row hasn't told us what to do, pause and ask the user.
      const candidates = nameToCandidates.get(name) ?? [];
      if (candidates.length > 0 && !relation) {
        conflicts.push({
          row: rowNum,
          name,
          system_code,
          // Only root systems can be parents — filter out sub-systems
          candidates: candidates.filter((c) =>
            !((existingRows ?? []) as any[]).find((e) => e.id === c.id)?.parent_system_id),
        });
        continue;
      }

      let parent_system_id: string | null = null;
      if (relation === "sub") {
        // Pick the override if provided, otherwise fall back to first candidate
        parent_system_id = parentIdOverride ?? candidates[0]?.id ?? null;
        if (!parent_system_id) {
          errors.push({ row: rowNum, reason: "לא נבחרה מערכת אב" });
          continue;
        }
      }

      seenInBatch.add(system_code);
      if (normalizedCode) seenNormalizedInBatch.add(normalizedCode);

      const phone = pick(r, ["טלפון", "phone", "טלפון לחיוג"]) || null;
      const caller_phone = pick(r, ["טלפון פונה", "caller_phone"]) || null;
      const source = pick(r, ["מקור", "source"]) || null;
      const email = pick(r, ["דוא\"ל", 'דוא"ל', "מייל", "email"]) || null;
      const notes = pick(r, ["הערות", "notes"]) || null;
      const agentName = pick(r, ["נציג", "נציג מטפל", "agent", "assigned_agent"]);
      const assigned_agent_id = (agentName && nameToAgent.get(agentName)) || context.userId;

      const missingOptional: string[] = [];
      if (!phone) missingOptional.push("טלפון");
      if (!caller_phone) missingOptional.push("טלפון פונה");
      if (!source) missingOptional.push("מקור");

      const finalNotes = missingOptional.length
        ? `[ייבוא — חסרים פרטים: ${missingOptional.join(", ")}]${notes ? "\n" + notes : ""}`
        : notes;

      const storedCode = normalizeSystemCode(system_code);
      const insertPayload: any = {
        system_code: storedCode, name, status,
        assigned_agent_id,
        notes: finalNotes,
        phone, source, caller_phone, email,
      };

      // Important: create the row with its Excel status first, then attach it
      // to the parent. This completely bypasses any parent-inheritance insert
      // trigger, so imported sub-systems keep the status from their own row.
      const { data: row, error } = await context.supabase
        .from("systems").insert(insertPayload).select("id, system_code, name").single();

      if (error) {
        errors.push({ row: rowNum, reason: error.message });
        continue;
      }
      if (parent_system_id && row?.id) {
        const { error: parentError } = await context.supabase
          .from("systems")
          .update({ parent_system_id })
          .eq("id", row.id);
        if (parentError) {
          await context.supabase.from("systems").delete().eq("id", row.id);
          errors.push({ row: rowNum, reason: parentError.message });
          continue;
        }
      }
      created.push(row);
      if (notes && row?.id) {
        try {
          await context.supabase.from("system_notes").insert({
            system_id: row.id, body: notes, author_id: context.userId,
          });
        } catch (e) {
          // Non-fatal — the system was created; just skip the note.
        }
      }
      // Register newly created root systems so later rows in the same
      // import can also conflict / become sub-systems if needed.
      if (!parent_system_id && row?.id && row?.name) {
        const key = String(row.name).trim();
        if (key) {
          const arr = nameToCandidates.get(key) ?? [];
          arr.push({ id: row.id, system_code: row.system_code, name: row.name });
          nameToCandidates.set(key, arr);
        }
      }
      if (missingOptional.length) incomplete.push(rowNum);
    }

    return { createdCount: created.length, errors, incompleteRows: incomplete, conflicts };
  });


// Scan every existing system_code, group by "prefix" (all digits except the
// last N), and identify series where enough sibling IDs share that prefix.
// A configurable settings row `series_detection` in app_settings drives which
// suffix-lengths to try and the minimum group size. For each series found,
// the missing numeric slots in the range [min..max] are returned so the
// admin can decide which ones to create.
export const scanSystemSeries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await userHasRole(context.userId, "admin");
    if (!isAdmin) throw new Error("רק מנהל יכול לסרוק סדרות");

    const { data: cfgRow } = await context.supabase
      .from("app_settings").select("value").eq("key", "series_detection").maybeSingle();
    const cfg = (cfgRow?.value as any) ?? { modes: [{ strip: 2, min: 10 }, { strip: 3, min: 30 }] };
    const modes: Array<{ strip: number; min: number }> = Array.isArray(cfg.modes) ? cfg.modes : [];
    if (!modes.length) return { series: [] as any[], settings: cfg };

    // Fetch codes with name + status so the UI can surface details about the
    // existing systems in each detected series.
    type Row = { id: string; system_code: string; name: string; status: string };
    const all: Row[] = [];
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: rows, error } = await context.supabase
        .from("systems").select("id, system_code, name, status").range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      all.push(...(rows as any[]).filter((r) => r?.system_code) as Row[]);
      if (rows.length < 1000) break;
      from += 1000;
      if (from > 50000) break;
    }
    const byDigits = new Map<string, Row>();
    for (const r of all) {
      const d = String(r.system_code).replace(/\D/g, "");
      if (d.length >= 4) byDigits.set(d, r);
    }
    const digitCodes = Array.from(byDigits.keys());
    const existingSet = new Set(digitCodes);

    // For each mode, build groups keyed by prefix.
    const seenPrefix = new Set<string>();
    const series: Array<{
      prefix: string;
      strip: number;
      width: number;
      count: number;
      min: string;
      max: string;
      existing: Array<{ code: string; id: string; name: string; status: string }>;
      missing: string[];
    }> = [];

    for (const mode of modes) {
      const groups = new Map<string, string[]>();
      for (const c of digitCodes) {
        if (c.length <= mode.strip) continue;
        const prefix = c.slice(0, c.length - mode.strip);
        const arr = groups.get(prefix) ?? [];
        arr.push(c);
        groups.set(prefix, arr);
      }
      for (const [prefix, members] of groups) {
        if (members.length < mode.min) continue;
        // Skip if we already recorded a series with a longer/equal prefix
        // (i.e. a more specific mode already covered these systems).
        if (seenPrefix.has(prefix)) continue;
        seenPrefix.add(prefix);

        const nums = members.map((m) => Number(m.slice(prefix.length)));
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const width = mode.strip;
        const wanted: string[] = [];
        for (let i = min; i <= max; i++) {
          wanted.push(prefix + String(i).padStart(width, "0"));
        }
        const missing = wanted.filter((w) => !existingSet.has(w));
        series.push({
          prefix,
          strip: mode.strip,
          width,
          count: members.length,
          min: prefix + String(min).padStart(width, "0"),
          max: prefix + String(max).padStart(width, "0"),
          existing: members.map((m) => {
            const r = byDigits.get(m)!;
            return { code: m, id: r.id, name: r.name, status: r.status };
          }).sort((a, b) => a.code.localeCompare(b.code)),
          missing,
        });
      }
    }
    // Only surface series that actually have gaps.
    return {
      series: series.filter((s) => s.missing.length > 0).sort((a, b) => b.missing.length - a.missing.length),
      settings: cfg,
    };
  });
