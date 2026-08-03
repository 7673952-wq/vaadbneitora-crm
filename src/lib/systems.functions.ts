import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { sanitizeText, sanitizeOptional } from "@/lib/sanitize";
import { readStatusSettings } from "@/lib/status-settings";
import { normalizeAdditionalCallerPhones } from "@/lib/caller-phones";

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
const statusSchema = z.string().min(1).max(80).regex(/^[a-z0-9_\-]+$/i);
const REPEAT_VALUES = ["day", "week", "month", "2months", "year", "custom"] as const;

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v)));
}

function statusLabelVariants(value: string) {
  const trimmed = value.trim();
  return uniqueStrings([
    trimmed,
    trimmed.replace(/\s+/g, " "),
    trimmed.replace(/וועדה/g, "ועדה"),
    trimmed.replace(/לוועדה/g, "לועדה"),
  ]);
}

async function buildStatusAliasMap(supabase: any) {
  const settings = await readStatusSettings(supabase);
  const aliasToKey = new Map<string, string>();
  for (const row of settings) {
    for (const alias of statusLabelVariants(row.status_key)) aliasToKey.set(alias, row.status_key);
    for (const alias of statusLabelVariants(row.label)) aliasToKey.set(alias, row.status_key);
  }
  return { settings, aliasToKey };
}

async function resolveStatusFilterValues(supabase: any, value?: string | null) {
  const raw = value?.trim();
  if (!raw) return [];
  const { settings, aliasToKey } = await buildStatusAliasMap(supabase);
  const normalizedRaw = raw.replace(/\s+/g, " ");
  const matchingSettings = settings.filter((row) =>
    statusLabelVariants(row.status_key).includes(raw)
      || statusLabelVariants(row.label).includes(raw)
      || row.label.replace(/\s+/g, " ") === normalizedRaw,
  );
  const canonicalRaw = aliasToKey.get(raw) ?? aliasToKey.get(normalizedRaw) ?? raw;
  return uniqueStrings([
    raw,
    canonicalRaw,
    ...matchingSettings.flatMap((row) => [row.status_key, ...statusLabelVariants(row.label)]),
  ]);
}

const PRIMARY_STATUS_VALUES = new Set<string>(STATUS_VALUES);
function primaryStatusFilterValues(values: string[]) {
  return values.filter((value) => PRIMARY_STATUS_VALUES.has(value));
}

function statusValueMatches(value: string | null | undefined, accepted: Set<string>) {
  if (!value) return false;
  return statusLabelVariants(String(value)).some((variant) => accepted.has(variant));
}

// All authorization in this file goes through `assertRole` / `hasRole`
// from @/lib/permissions.server — single source of truth.
async function userHasRole(userId: string, role: "agent" | "admin" | "super_admin") {
  const { getCrmRoles, ROLE_HIERARCHY } = await import("@/lib/permissions.server");
  const roles = await getCrmRoles(userId, "yemot");
  return roles.some((r) => ROLE_HIERARCHY.indexOf(r) <= ROLE_HIERARCHY.indexOf(role));
}
// Read-only viewers cannot mutate anything — call at the top of every write handler.
async function ensureCanWrite(userId: string) {
  const { assertCanWrite } = await import("@/lib/permissions.server");
  await assertCanWrite(userId, "yemot");
}


const periodSchema = z.enum(["day", "week", "month", "year"]);
const isoDate = z.string().datetime().or(z.string().min(4)).nullable().optional();
const listStatusFilterSchema = z.string().min(1).max(100);
const listSystemsInputSchema = z.object({
  status: listStatusFilterSchema.nullable().optional(),
  secondaryStatus: listStatusFilterSchema.nullable().optional(),
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
    const { assertCrmAccess } = await import("@/lib/permissions.server");
    await assertCrmAccess(context.userId, "yemot");
    const db = context.supabase;
    const statusValues = await resolveStatusFilterValues(db, data.status);
    const secondaryStatusValues = await resolveStatusFilterValues(db, data.secondaryStatus);
    const primaryStatusValues = primaryStatusFilterValues(statusValues);
    if (data.status && statusValues.length === 0 && secondaryStatusValues.length === 0) {
      return { items: [], total: 0, page: data.page ?? 1, pageSize: data.pageSize ?? 1000 };
    }
    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 1000;
    const offset = (page - 1) * pageSize;
    const endTo = offset + pageSize - 1;

    const baseSelect =
      "id, system_code, name, status, secondary_status, assigned_agent_id, notes, phone, caller_phone, additional_caller_phones, email, additional_emails, source, reminder_at, reminder_agent_ids, handled_pending_at, parent_system_id, audio_url, has_unread_email, last_inbound_email_at, created_at, updated_at";


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

    // Dashboard priority: systems still waiting for treatment must always be
    // shown before handled ones — even when the view is capped to a page
    // size (50/100/200). Sorting purely by "most recently updated" and then
    // cutting off at the page size can bury an old waiting system under a
    // page full of rows that were simply handled more recently. To guarantee
    // the ordering we fetch every row matching the current filters, sort by
    // (waiting-first, then most-recently-updated), and only then slice out
    // the requested page.
    const { data: statusRows } = await db
      .from("status_settings").select("status_key, is_handled");
    const handledKeys = new Set<string>((statusRows ?? []).filter((r: any) => r.is_handled).map((r: any) => r.status_key));
    if (handledKeys.size === 0) {
      ["open", "closed", "blocked_from_root", "sent_to_yosela", "sent_to_committee", "blocked_in_committee"].forEach((k) => handledKeys.add(k));
    }
    const sortWaitingFirst = (rows: any[]) => [...rows].sort((a, b) => {
      const aHandled = handledKeys.has(a.status) ? 1 : 0;
      const bHandled = handledKeys.has(b.status) ? 1 : 0;
      if (aHandled !== bHandled) return aHandled - bHandled; // waiting (0) before handled (1)
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    const CHUNK = 1000;

    // Status filters must support both the fixed enum column (`status`) and
    // the flexible optional column (`secondary_status`), including custom
    // statuses and legacy rows that stored workflow statuses in either place.
    // Fetch the filtered set in JS instead of building enum/text OR queries,
    // so a custom optional status can never be dropped by the database cast.
    if (statusValues.length > 0 || secondaryStatusValues.length > 0) {
      const statusSet = new Set(statusValues);
      const secondaryStatusSet = new Set(secondaryStatusValues);
      const pageQuery = (from: number, withCount: boolean) => {
        let q = db.from("systems").select(baseSelect, withCount ? { count: "exact" } : {});
        return applySharedFilters(q).order("updated_at", { ascending: false }).range(from, from + CHUNK - 1);
      };
      const { data: firstRows, error: firstErr, count } = await pageQuery(0, true);
      if (firstErr) throw new Error(firstErr.message);
      const allRows: any[] = [...(firstRows ?? [])];
      const totalRows = typeof count === "number" ? count : allRows.length;
      if (totalRows > CHUNK) {
        const rest: any[] = [];
        for (let from = CHUNK; from < totalRows; from += CHUNK) rest.push(pageQuery(from, false));
        for (const res of await Promise.all(rest)) {
          if (res.error) throw new Error(res.error.message);
          allRows.push(...(res.data ?? []));
        }
      }

      const filteredRows = allRows.filter((row) => {
        const matchesPrimary = statusValues.length === 0
          || statusValueMatches(row.status, statusSet);
        const matchesSecondary = secondaryStatusValues.length === 0
          || statusValueMatches(row.secondary_status, secondaryStatusSet)
          || statusValueMatches(row.status, secondaryStatusSet);
        return matchesPrimary && matchesSecondary;
      });
      const orderedRows = sortWaitingFirst(filteredRows);
      const items = await enrichSystemRows(db, orderedRows.slice(offset, endTo + 1));
      return { items, total: orderedRows.length, page, pageSize };
    }

    // No status filter: fetch every row matching the remaining filters (in
    // 1000-row chunks — PostgREST caps a single response there — fetched
    // concurrently after the first page tells us the total) so the
    // waiting/handled ordering above can be applied across the whole set,
    // then slice out the requested page.
    const buildQuery = (from: number, withCount: boolean) => {
      let q = db
        .from("systems")
        .select(baseSelect, withCount ? { count: "exact" } : {});
      if (primaryStatusValues.length > 0) q = q.in("status", primaryStatusValues as any);
      return applySharedFilters(q).order("updated_at", { ascending: false }).range(from, from + CHUNK - 1);
    };
    const { data: firstPageRows, error: firstPageErr, count: firstCount } = await buildQuery(0, true);
    if (firstPageErr) throw new Error(firstPageErr.message);
    const allRows: any[] = [...(firstPageRows ?? [])];
    const total = typeof firstCount === "number" ? firstCount : allRows.length;
    if (total > CHUNK) {
      const remaining: Promise<any>[] = [];
      for (let from = CHUNK; from < total; from += CHUNK) remaining.push(buildQuery(from, false));
      for (const res of await Promise.all(remaining)) {
        if (res.error) throw new Error(res.error.message);
        allRows.push(...(res.data ?? []));
      }
    }
    const orderedRows = sortWaitingFirst(allRows);
    const items = await enrichSystemRows(db, orderedRows.slice(offset, endTo + 1));
    return { items, total: total || orderedRows.length, page, pageSize };
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
    const { aliasToKey } = await buildStatusAliasMap(context.supabase);
    const canonicalStatus = (value?: string | null) => value ? (aliasToKey.get(value) ?? value) : null;
    // Paginate through everything to bypass the 1000-row default — fetch
    // the first page to learn the total row count, then fetch any
    // remaining pages concurrently instead of one-at-a-time (previously
    // this awaited each 1000-row page sequentially, which visibly added
    // up on every dashboard load since this query fires on every filter
    // change alongside listSystems).
    const primary: Record<string, number> = {};
    const secondary: Record<string, number> = {};
    const any: Record<string, number> = {};
    const pageSize = 1000;
    const countQuery = (from: number, to: number, withCount: boolean) => {
      let pq = context.supabase.from("systems").select("status, secondary_status", withCount ? { count: "exact" } : {});
      if (data.agentId) pq = pq.eq("assigned_agent_id", data.agentId);
      if (data.period) {
        const now = new Date();
        const start = new Date(now);
        if (data.period === "day") start.setDate(now.getDate() - 1);
        else if (data.period === "week") start.setDate(now.getDate() - 7);
        else if (data.period === "month") start.setMonth(now.getMonth() - 1);
        else if (data.period === "year") start.setFullYear(now.getFullYear() - 1);
        pq = pq.gte("updated_at", start.toISOString());
      }
      if (data.dateFrom) pq = pq.gte("updated_at", new Date(data.dateFrom).toISOString());
      if (data.dateTo) pq = pq.lte("updated_at", new Date(data.dateTo).toISOString());
      return pq.range(from, to);
    };
    const tally = (rows: any[]) => {
      for (const r of rows) {
        const primaryKey = canonicalStatus(r.status);
        const secondaryKey = canonicalStatus(r.secondary_status);
        if (primaryKey) primary[primaryKey] = (primary[primaryKey] ?? 0) + 1;
        if (secondaryKey) secondary[secondaryKey] = (secondary[secondaryKey] ?? 0) + 1;
        for (const key of new Set([primaryKey, secondaryKey].filter(Boolean))) {
          any[key as string] = (any[key as string] ?? 0) + 1;
        }
      }
    };
    const { data: firstRows, error: firstErr, count } = await countQuery(0, pageSize - 1, true);
    if (firstErr) throw new Error(firstErr.message);
    tally((firstRows ?? []) as any[]);
    const total = typeof count === "number" ? count : (firstRows?.length ?? 0);
    if (total > pageSize) {
      const remainingPages: any[] = [];
      for (let from = pageSize; from < total; from += pageSize) {
        remainingPages.push(countQuery(from, from + pageSize - 1, false));
      }
      const results = await Promise.all(remainingPages);
      for (const res of results) {
        if (res.error) throw new Error(res.error.message);
        tally((res.data ?? []) as any[]);
      }
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

    // Opening a system clears its "unread email" flag so it drops off the
    // dashboard indicator immediately. Fire-and-forget — best-effort.
    if ((sys as any).has_unread_email) {
      context.supabase.from("systems").update({ has_unread_email: false } as any).eq("id", data.id)
        .then(() => {}, () => {});
      (sys as any).has_unread_email = false;
    }

    const [notesRes, transfersRes, childrenRes, activityRes, profilesRes, parentRes] = await Promise.all([
      context.supabase.from("system_notes").select("*").eq("system_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("system_transfers").select("*").eq("system_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("systems").select("id, system_code, name, status, assigned_agent_id, created_at")
        .eq("parent_system_id", data.id).order("created_at", { ascending: true }),
      context.supabase.from("system_activity_log").select("*").eq("system_id", data.id)
        .order("created_at", { ascending: false }).limit(300),
      context.supabase.from("profiles").select("id, display_name"),
      sys.parent_system_id
        ? context.supabase.from("systems").select("id, system_code, name, status").eq("id", sys.parent_system_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const notes = notesRes.data;
    const transfers = transfersRes.data;
    const children = childrenRes.data;
    const activity = activityRes.data;
    const profiles = profilesRes.data;
    const parent = (parentRes.data as { id: string; system_code: string; name: string; status: string } | null) ?? null;

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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("systems").insert({
      system_code: normalizeSystemCode(data.system_code),
      name: sanitizeText(data.name?.trim() || parent.name || ""),
      status: (data.status ?? "open") as any,
      assigned_agent_id: parent.assigned_agent_id,
      parent_system_id: parent.id,
      notes: cleanSubNotes,
      phone: sanitizeOptional(data.phone ?? null),
      source: sanitizeOptional(data.source ?? null),
      caller_phone: sanitizeOptional(data.caller_phone ?? null),
      email: data.email || null,
    }).select().single();
    if (error) throw new Error(error.message);
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
    source?: string; caller_phone?: string; email?: string; is_blocking_number?: boolean;
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
      is_blocking_number: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const allowed = await userHasRole(context.userId, "agent");
    if (!allowed) throw new Error("רק נציג ומעלה יכול לפתוח מערכת");
    const normalizedCode = normalizeSystemCode(data.system_code);
    const { data: existing } = await context.supabase
      .from("systems").select("id").eq("system_code", normalizedCode).is("parent_system_id", null).maybeSingle();
    if (existing) throw new Error("מספר המערכת כבר קיים כמערכת שורש — לא ניתן לפתוח מערכת ראשית נוספת עם אותו מספר");
    // Auto-assign the creator as the handling agent if none was selected.
    const assignedAgentId = data.assigned_agent_id ?? context.userId;
    const cleanNotes = sanitizeOptional(data.notes ?? null);
    const { data: row, error } = await context.supabase.from("systems").insert({
      system_code: normalizedCode,
      name: sanitizeText(data.name),
      status: data.status as any,
      assigned_agent_id: assignedAgentId,
      notes: cleanNotes,
      phone: sanitizeOptional(data.phone || null),
      source: sanitizeOptional(data.source ?? null),
      caller_phone: sanitizeOptional(data.caller_phone ?? null),
      email: data.email || null,
      is_blocking_number: data.is_blocking_number ?? false,
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
    additional_emails?: string[] | null;
    reason?: string;
    apply_to_children?: boolean;
    is_blocking_number?: boolean;
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
      additional_emails: z.array(z.string().email().max(200)).max(20).nullable().optional(),
      reason: z.string().max(500).optional(),
      apply_to_children: z.boolean().optional(),
      is_blocking_number: z.boolean().optional(),
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
    if (data.system_code !== undefined) {
      const { hasPermission } = await import("@/lib/permissions.server");
      if (!(await hasPermission(context.userId, "system_code_edit"))) {
        throw new Error("אין הרשאה לשנות את מזהה המערכת");
      }
    }
    if (data.name !== undefined) {
      const { hasPermission } = await import("@/lib/permissions.server");
      if (!(await hasPermission(context.userId, "system_name_edit"))) {
        throw new Error("אין הרשאה לשנות את שם המערכת");
      }
    }
    const statusLogTargets: Array<{ id: string; oldStatus: string; newStatus: string }> = [];
    const isRootStatusChange =
      data.status !== undefined
      && data.status !== sys.status
      && !sys.parent_system_id;
    const shouldCascadeStatus = isRootStatusChange && data.apply_to_children === true;
    let cascadeChildren: Array<{ id: string; status: string }> = [];
    if (data.status && data.status !== sys.status) {
      statusLogTargets.push({ id: data.id, oldStatus: sys.status, newStatus: data.status });
      if (isRootStatusChange) {
        const { data: children } = await context.supabase
          .from("systems")
          .select("id, status")
          .eq("parent_system_id", data.id);
        const allChildren = (children ?? []) as Array<{ id: string; status: string }>;
        cascadeChildren = shouldCascadeStatus
          ? allChildren.filter((child) => child.status !== data.status)
          : allChildren;
        if (shouldCascadeStatus) {
          statusLogTargets.push(...cascadeChildren.map((child) => ({
            id: child.id,
            oldStatus: child.status,
            newStatus: data.status!,
          })));
        }
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

    const { id, reason: _r, email, apply_to_children: _ac, ...patch } = data as any;
    if (email !== undefined) (patch as any).email = email || null;
    const { data: row, error } = await context.supabase.from("systems").update(patch).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    // Explicit sub-system status cascade (opt-in via apply_to_children).
    if (shouldCascadeStatus && cascadeChildren.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("systems")
        .update({ status: data.status as any })
        .in("id", cascadeChildren.map((c) => c.id));
    }
    // Defensive guard: older deployments/triggers may still propagate parent
    // statuses. When the user chose "no", restore each child to its prior
    // status so the dialog answer is authoritative.
    if (isRootStatusChange && data.apply_to_children !== true && cascadeChildren.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await Promise.all(cascadeChildren.map((child) => supabaseAdmin
        .from("systems")
        .update({ status: child.status as any })
        .eq("id", child.id)
        .neq("status", child.status as any)));
    }
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
    // Automatic voice-message send/queue when the status changes to one
    // configured for auto-sending (admin > statuses).
    if (data.status && data.status !== sys.status) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await maybeScheduleOrSendAutoVoice(supabaseAdmin, id, data.status);
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
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "history_edit");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin.from("system_activity_log").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteActivityLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "history_edit");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("system_activity_log").delete().eq("id", data.id);
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

export const updateNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; body: string }) =>
    z.object({ id: z.string().uuid(), body: z.string().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { hasPermission } = await import("@/lib/permissions.server");
    const { data: existing, error: fetchErr } = await context.supabase
      .from("system_notes").select("author_id").eq("id", data.id).maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) throw new Error("ההערה לא נמצאה");
    const isAuthor = (existing as any).author_id === context.userId;
    const canEditAll = await hasPermission(context.userId, "history_edit");
    if (!isAuthor && !canEditAll) throw new Error("אין הרשאה לערוך הערה של משתמש אחר");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("system_notes").update({ body: sanitizeText(data.body) }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { hasPermission } = await import("@/lib/permissions.server");
    const { data: existing, error: fetchErr } = await context.supabase
      .from("system_notes").select("author_id").eq("id", data.id).maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) throw new Error("ההערה לא נמצאה");
    const isAuthor = (existing as any).author_id === context.userId;
    const canEditAll = await hasPermission(context.userId, "history_edit");
    if (!isAuthor && !canEditAll) throw new Error("אין הרשאה למחוק הערה של משתמש אחר");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("system_notes").delete().eq("id", data.id);
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
    const { data: updated, error } = await context.supabase
      .from("systems")
      .update({ reminder_at: null, reminder_agent_ids: [], reminder_handled: true, snoozed_until: null })
      .eq("id", data.system_id)
      .select("id");
    if (error) throw new Error(error.message);
    // The bell is shared across every CRM — the same id may be a CRM record.
    if (!updated || updated.length === 0) {
      const { error: crmErr } = await context.supabase
        .from("crm_records").update({ reminder_at: null }).eq("id", data.system_id);
      if (crmErr) throw new Error(crmErr.message);
    }
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
        .select("id, system_code, name, status, reminder_at, reminder_agent_ids, reminder_handled, snoozed_until, updated_at, assigned_agent_id")
        .in("status", myWaitingStatuses as any)
        .eq("reminder_handled", false)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (e3) throw new Error(e3.message);
      derived = rows ?? [];
    }

    // Waiting for the currently assigned representative: every untreated
    // non-handled status assigned to me should appear in the bell immediately,
    // not only after the stale threshold passes.
    let assignedWaiting: any[] = [];
    if (pendingStatusKeys.length) {
      const { data: rows, error: eAssigned } = await context.supabase
        .from("systems")
        .select("id, system_code, name, status, reminder_at, reminder_agent_ids, reminder_handled, snoozed_until, updated_at, assigned_agent_id")
        .eq("assigned_agent_id", context.userId)
        .in("status", pendingStatusKeys as any)
        .eq("reminder_handled", false)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (eAssigned) throw new Error(eAssigned.message);
      assignedWaiting = rows ?? [];
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
    for (const r of assignedWaiting) {
      if (!notSnoozed(r)) continue;
      if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, source: "assigned" }); }
    }
    for (const r of stale) {
      if (!notSnoozed(r)) continue;
      if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, source: "stale" }); }
    }

    // ===== Records from every other CRM =====
    // The general settings (auto-snooze threshold, status handling) apply to
    // all CRMs, so their pending records feed the same notification bell.
    const { data: crmManual } = await context.supabase
      .from("crm_records")
      .select("id, crm_key, record_code, name, status, reminder_at, assigned_agent_id, updated_at")
      .not("reminder_at", "is", null)
      .lte("reminder_at", nowIso)
      .order("reminder_at", { ascending: true })
      .limit(200);

    let crmStale: any[] = [];
    if (thresholdDays > 0 && pendingStatusKeys.length) {
      const cutoff = new Date(Date.now() - thresholdDays * 86400_000).toISOString();
      const { data: rows } = await context.supabase
        .from("crm_records")
        .select("id, crm_key, record_code, name, status, reminder_at, assigned_agent_id, updated_at")
        .eq("assigned_agent_id", context.userId)
        .in("status", pendingStatusKeys as any)
        .lt("updated_at", cutoff)
        .order("updated_at", { ascending: true })
        .limit(500);
      crmStale = rows ?? [];
    }

    const pushCrm = (r: any, source: string) => {
      if (seen.has(r.id)) return;
      seen.add(r.id);
      out.push({
        id: r.id, crm_key: r.crm_key, system_code: r.record_code, name: r.name,
        status: r.status, reminder_at: r.reminder_at, source,
      });
    };
    for (const r of (crmManual ?? []) as any[]) pushCrm(r, "manual");
    for (const r of crmStale) pushCrm(r, "stale");

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
        status: data.status as any,
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
    // Build all reasonable variants of the input: forward + reversed,
    // with/without the 0 and 972 prefixes. This lets users find a system
    // whether they typed the number directly, without prefix, or in
    // reverse digit order.
    const raw = String(data.code).trim();
    const digits = raw.replace(/\D/g, "");
    const stripped = digits.replace(/^972/, "").replace(/^0+/, "");
    if (stripped.length < 2 && !raw) return [];

    const variants = new Set<string>();
    const push = (v: string) => { if (v && v.length >= 2) variants.add(v); };
    push(raw);
    if (digits) push(digits);
    if (stripped) {
      push(stripped);
      push("0" + stripped);
      push("972" + stripped);
      const reversed = stripped.split("").reverse().join("");
      if (reversed && reversed !== stripped) {
        push(reversed);
        push("0" + reversed);
        push("972" + reversed);
      }
    }
    if (!variants.size) return [];

    const { data: rows } = await context.supabase
      .from("systems")
      .select("id, system_code, name, status, parent_system_id, assigned_agent_id")
      .in("system_code", Array.from(variants) as any)
      .limit(20);
    if (!rows || rows.length === 0) return [];
    // Exact match against the raw input first, then the rest in whatever order they came back.
    const exact = rows.filter((r: any) => r.system_code === raw);
    const rest = rows.filter((r: any) => r.system_code !== raw);
    return [...exact, ...rest];
  });

// Ensures a persistent ROOT system with the given name exists (used for
// "category" parents like "קו ההגנה" that group many sub-systems). If a root
// with that exact name is missing it is created on-the-fly and returned.
export const ensureCategoryRoot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string }) => z.object({ name: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const allowed = await userHasRole(context.userId, "agent");
    if (!allowed) throw new Error("רק נציג ומעלה יכול לפתוח מערכת");
    const name = sanitizeText(data.name).trim();
    const { data: found } = await context.supabase
      .from("systems")
      .select("id, system_code, name, parent_system_id")
      .ilike("name", name)
      .is("parent_system_id", null)
      .limit(1)
      .maybeSingle();
    if (found) return found;
    let code = `cat-${name}`;
    for (let i = 0; i < 5; i++) {
      const { data: taken } = await context.supabase
        .from("systems").select("id").eq("system_code", code).is("parent_system_id", null).maybeSingle();
      if (!taken) break;
      code = `cat-${name}-${Math.floor(Math.random() * 1e6)}`;
    }
    const { data: row, error } = await context.supabase.from("systems").insert({
      system_code: code,
      name,
      status: "open" as any,
      assigned_agent_id: context.userId,
    } as any).select("id, system_code, name, parent_system_id").single();
    if (error) throw new Error(error.message);
    return row;
  });

// Handling-speed trend: for each time bucket in the selected period, returns
// how many systems reached a "handled" status (throughput) and the average
// hours from system creation to that first handled transition (avgHours).
export const getHandlingSpeedTrend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { period: string; compareToPrevious?: boolean }) =>
    z.object({
      period: z.enum(["day", "3days", "week", "month", "year"]),
      compareToPrevious: z.boolean().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // Bucketing config per period.
    const cfg: Record<string, { hours: number; bucketMs: number; label: (d: Date) => string }> = {
      day:    { hours: 24,        bucketMs: 60 * 60 * 1000,             label: (d) => String(getIsraelHour(d)).padStart(2, "0") + ":00" },
      "3days":{ hours: 72,        bucketMs: 3 * 60 * 60 * 1000,         label: (d) => `${d.getDate()}/${d.getMonth()+1} ${String(getIsraelHour(d)).padStart(2,"0")}:00` },
      week:   { hours: 24 * 7,    bucketMs: 24 * 60 * 60 * 1000,        label: (d) => `${d.getDate()}/${d.getMonth()+1}` },
      month:  { hours: 24 * 30,   bucketMs: 24 * 60 * 60 * 1000,        label: (d) => `${d.getDate()}/${d.getMonth()+1}` },
      year:   { hours: 24 * 365,  bucketMs: 7 * 24 * 60 * 60 * 1000,    label: (d) => `${d.getDate()}/${d.getMonth()+1}` },
    };
    const c = cfg[data.period];

    const { data: statusRows } = await context.supabase
      .from("status_settings").select("status_key, is_handled");
    const handledKeys = new Set<string>((statusRows ?? []).filter((r: any) => r.is_handled).map((r: any) => r.status_key));
    if (handledKeys.size === 0) {
      ["open", "closed", "blocked_from_root", "sent_to_yosela", "sent_to_committee", "blocked_in_committee"].forEach((k) => handledKeys.add(k));
    }
    const MIN_REAL_GAP_MS = 2 * 60_000;

    async function computeWindow(fromTs: number, toTs: number) {
      const from = new Date(fromTs), to = new Date(toTs);
      const { data: logs } = await context.supabase
        .from("system_activity_log")
        .select("system_id, new_value, created_at")
        .eq("field", "status")
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("created_at", { ascending: true })
        .limit(10000);
      const firstHandledBySystem = new Map<string, string>();
      for (const l of (logs ?? []) as any[]) {
        if (!handledKeys.has(l.new_value)) continue;
        if (firstHandledBySystem.has(l.system_id)) continue;
        firstHandledBySystem.set(l.system_id, l.created_at);
      }
      const handledArr = Array.from(handledKeys);
      if (handledArr.length > 0) {
        const { data: curHandled } = await context.supabase
          .from("systems").select("id, updated_at, created_at")
          .in("status", handledArr as any)
          .gte("updated_at", from.toISOString()).lte("updated_at", to.toISOString())
          .limit(10000);
        for (const s of (curHandled ?? []) as any[]) {
          if (firstHandledBySystem.has(s.id)) continue;
          const gap = new Date(s.updated_at).getTime() - new Date(s.created_at).getTime();
          if (gap < MIN_REAL_GAP_MS) continue;
          firstHandledBySystem.set(s.id, s.updated_at);
        }
      }
      const systemIds = Array.from(firstHandledBySystem.keys());
      const createdMap = new Map<string, string>();
      if (systemIds.length > 0) {
        const idChunks: string[][] = [];
        for (let i = 0; i < systemIds.length; i += 500) idChunks.push(systemIds.slice(i, i + 500));
        const chunkResults = await Promise.all(idChunks.map((chunk) =>
          context.supabase.from("systems").select("id, created_at").in("id", chunk)));
        for (const { data: sys, error: sysErr } of chunkResults) {
          if (sysErr) continue;
          for (const s of (sys ?? [])) createdMap.set(s.id as string, s.created_at as string);
        }
      }
      const buckets = new Map<number, { count: number; totalHours: number; withDuration: number }>();
      const startBucket = Math.floor(fromTs / c.bucketMs) * c.bucketMs;
      for (let t = startBucket; t <= toTs; t += c.bucketMs) buckets.set(t, { count: 0, totalHours: 0, withDuration: 0 });
      for (const [sid, handledAtStr] of firstHandledBySystem.entries()) {
        const handledAt = new Date(handledAtStr).getTime();
        const bkt = Math.floor(handledAt / c.bucketMs) * c.bucketMs;
        const b = buckets.get(bkt); if (!b) continue;
        b.count += 1;
        const createdAtStr = createdMap.get(sid);
        if (!createdAtStr) continue;
        const hours = Math.max(0, (handledAt - new Date(createdAtStr).getTime()) / 3600_000);
        b.totalHours += hours;
        b.withDuration += 1;
      }
      return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    }

    const now = Date.now();
    const windowMs = c.hours * 3600_000;
    const curr = await computeWindow(now - windowMs, now);
    const prev = data.compareToPrevious ? await computeWindow(now - 2 * windowMs, now - windowMs) : [];

    return curr.map(([t, v], i) => {
      const p = prev[i]?.[1];
      return {
        bucket: c.label(new Date(t)),
        throughput: v.count,
        avgHours: v.withDuration > 0 ? Number((v.totalHours / v.withDuration).toFixed(1)) : 0,
        throughputPrev: p?.count ?? null,
        avgHoursPrev: p && p.withDuration > 0 ? Number((p.totalHours / p.withDuration).toFixed(1)) : null,
      };
    });
  });

// % of systems that were HANDLED within `withinDays` of being opened, among
// systems opened in `openedPeriod`. Handled-time is derived from the first
// status transition to a "handled" status in the activity log (falls back to
// updated_at when no log entry exists).
export const getHandledRatio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { openedPeriod: string; withinDays: number; compareToPrevious?: boolean }) =>
    z.object({
      openedPeriod: z.enum(["day", "3days", "week", "month", "year"]),
      withinDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(30)]),
      compareToPrevious: z.boolean().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const hoursByPeriod: Record<string, number> = {
      day: 24, "3days": 72, week: 24 * 7, month: 24 * 30, year: 24 * 365,
    };
    const windowMs = hoursByPeriod[data.openedPeriod] * 3600_000;

    const { data: statusRows } = await context.supabase
      .from("status_settings").select("status_key, is_handled");
    const handledKeys = new Set<string>((statusRows ?? []).filter((r: any) => r.is_handled).map((r: any) => r.status_key));
    if (handledKeys.size === 0) {
      ["open", "closed", "blocked_from_root", "sent_to_yosela", "sent_to_committee", "blocked_in_committee"].forEach((k) => handledKeys.add(k));
    }
    const MIN_REAL_GAP_MS = 2 * 60_000;
    const withinMs = data.withinDays * 24 * 3600_000;

    async function computeRatio(fromTs: number, toTs: number) {
      const { data: sys } = await context.supabase
        .from("systems").select("id, status, created_at, updated_at")
        .gte("created_at", new Date(fromTs).toISOString())
        .lte("created_at", new Date(toTs).toISOString())
        .limit(50000);
      const rows = (sys ?? []) as any[];
      if (rows.length === 0) return { handledInTime: 0, notHandledInTime: 0, total: 0 };
      const ids = rows.map((r) => r.id);
      const firstHandled = new Map<string, string>();
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
      const chunkResults = await Promise.all(chunks.map((chunk) =>
        context.supabase.from("system_activity_log")
          .select("system_id, new_value, created_at")
          .eq("field", "status").in("system_id", chunk)
          .order("created_at", { ascending: true }).limit(20000)));
      for (const { data: logs } of chunkResults) {
        for (const l of (logs ?? []) as any[]) {
          if (!handledKeys.has(l.new_value)) continue;
          if (firstHandled.has(l.system_id)) continue;
          firstHandled.set(l.system_id, l.created_at);
        }
      }
      let handledInTime = 0, notHandledInTime = 0;
      for (const r of rows) {
        const isHandledNow = handledKeys.has(r.status);
        const fromLog = firstHandled.get(r.id);
        let handledAt: string | null = fromLog ?? null;
        if (!handledAt && isHandledNow) {
          const gap = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime();
          if (gap >= MIN_REAL_GAP_MS) handledAt = r.updated_at;
        }
        if (!handledAt) { notHandledInTime++; continue; }
        const delta = new Date(handledAt).getTime() - new Date(r.created_at).getTime();
        if (delta >= 0 && delta <= withinMs) handledInTime++;
        else notHandledInTime++;
      }
      return { handledInTime, notHandledInTime, total: rows.length };
    }

    const now = Date.now();
    const cur = await computeRatio(now - windowMs, now);
    const prev = data.compareToPrevious ? await computeRatio(now - 2 * windowMs, now - windowMs) : null;
    return {
      handledInTime: cur.handledInTime,
      notHandledInTime: cur.notHandledInTime,
      total: cur.total,
      withinDays: data.withinDays,
      previous: prev,
    };
  });

// Status funnel: count of systems per status for a period (by created_at).
export const getStatusFunnel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { period: string }) =>
    z.object({ period: z.enum(["day", "3days", "week", "month", "year", "all"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const hoursByPeriod: Record<string, number | null> = {
      day: 24, "3days": 72, week: 24 * 7, month: 24 * 30, year: 24 * 365, all: null,
    };
    const h = hoursByPeriod[data.period];

    const { data: statusRows } = await context.supabase
      .from("status_settings").select("status_key, label, tone, sort_order");
    const statusMeta = new Map<string, { label: string; tone: string; sort_order: number }>();
    for (const r of (statusRows ?? []) as any[]) {
      statusMeta.set(r.status_key, { label: r.label ?? r.status_key, tone: r.tone ?? "gray", sort_order: r.sort_order ?? 999 });
    }

    let q = context.supabase.from("systems").select("status").limit(50000);
    if (h !== null) q = q.gte("created_at", new Date(Date.now() - h * 3600_000).toISOString());
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const r of (rows ?? []) as any[]) {
      const k = r.status ?? "—";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const out = Array.from(counts.entries()).map(([status_key, count]) => {
      const meta = statusMeta.get(status_key) ?? { label: status_key, tone: "gray", sort_order: 999 };
      return { status_key, label: meta.label, tone: meta.tone, sort_order: meta.sort_order, count };
    }).sort((a, b) => b.count - a.count);
    return out;
  });

// --- Yemot HaMashiach: prepare a per-phone extension and call it ---
function getIsraelHour(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false });
  const hourPart = fmt.formatToParts(date).find((p) => p.type === "hour")?.value ?? "0";
  return parseInt(hourPart, 10) % 24;
}

function isWithinIsraelWindow(date: Date, startHour: number, endHour: number): boolean {
  const h = getIsraelHour(date);
  // endHour is exclusive; a window like 8-20 covers hours 8..19.
  if (startHour === endHour) return true; // 24/7 window
  if (startHour < endHour) return h >= startHour && h < endHour;
  // Overnight window (e.g. 20 -> 6)
  return h >= startHour || h < endHour;
}

function nextIsraelWindowStart(from: Date, startHour: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    d.setUTCHours(d.getUTCHours() + 1);
    if (getIsraelHour(d) === startHour) return d;
  }
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

// Core Yemot HaMashiach voice-send flow, usable both from the authenticated
// manual "send" button and from the automatic/queued sender (no user context).
async function runYemotVoiceSendInner(supabaseAdmin: any, systemId: string, phoneIndex: number) {
  const apiKey = (process.env.YEMOT_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("מפתח ה־API של ימות המשיח לא מוגדר בשרת (YEMOT_API_KEY)");
  }

  const { data: sysRow, error: sysErr } = await supabaseAdmin
    .from("systems")
    .select("*")
    .eq("id", systemId)
    .maybeSingle();
  if (sysErr) throw sysErr;
  if (!sysRow) throw new Error("המערכת לא נמצאה");
  const sys = sysRow as any;

  const idx = phoneIndex;
  const additional = normalizeAdditionalCallerPhones(sys.additional_caller_phones);

  let rawPhone = "";
  if (idx < 0) {
    rawPhone = String(sys.caller_phone || sys.phone || "");
  } else {
    const entry = additional[idx];
    if (!entry) throw new Error("מספר פונה נוסף לא נמצא");
    rawPhone = String(entry.phone || "");
  }
  const phone = rawPhone.replace(/[^\d]/g, "");
  if (!phone) throw new Error("אין מספר טלפון לפונה");

  const settings = await readStatusSettings(supabaseAdmin);
  const cur = settings.find((r: any) => r.status_key === sys.status) as any;
  if (!cur?.enables_voice_message) {
    throw new Error("לא ניתן לשלוח הודעה בסטטוס זה");
  }
  const messageFile = String(cur.voice_message_template || "").trim();
  if (!messageFile) {
    throw new Error("לא הוגדר מספר הודעה עבור הסטטוס הזה");
  }
  if (!/^\d+$/.test(messageFile)) {
    throw new Error("מספר ההודעה של הסטטוס חייב להכיל ספרות בלבד");
  }

  let systemCode = String(sys.system_code || "").trim();
  if (!systemCode) throw new Error("אין מספר מערכת לשליחה");
  if (sys.is_blocking_number) {
    // "Blocking number" systems: send the ID digits reversed, with any
    // leading zero(s) dropped first — e.g. 0123456789 -> 987654321.
    const strippedCode = systemCode.replace(/^0+/, "");
    systemCode = strippedCode.split("").reverse().join("");
    if (!systemCode) throw new Error("אין מספר מערכת לשליחה");
  }

  const ymBase = "https://www.call2all.co.il/ym/api";
  const extensionPath = `ivr2:0CRM/Phone/${phone}`;
  const jsonHeaders = { authorization: apiKey, "Content-Type": "application/json" };
  const callYemot = async (endpoint: string, params: Record<string, string>, accept: (json: any) => boolean) => {
    let res: Response;
    try {
      res = await fetch(`${ymBase}/${endpoint}`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(params),
      });
    } catch (e: any) {
      throw new Error(`שגיאת רשת מול ימות המשיח: ${e?.message ?? e}`);
    }
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || !json || !accept(json)) {
      const msg = json?.message || json?.responseMessage || `הפעולה נכשלה (סטטוס ${res.status})`;
      throw new Error(`ימות המשיח (${endpoint}): ${msg}`);
    }
    return json;
  };

  await callYemot("UpdateExtension", { path: extensionPath }, (json) => json.responseStatus === "OK");
  const fileActionJson = await callYemot("FileAction", {
    what: `ivr2:0CRM/files/${messageFile}.wav`,
    target: extensionPath,
  }, (json) => json.responseStatus === "OK" && (json.success !== false));
  const copiedTarget = String(fileActionJson?.reports?.[0]?.target || fileActionJson?.target || "");
  const targetMatch = copiedTarget.match(/\/([^/]+)\.wav$/i);
  const fileId = targetMatch?.[1];
  if (!fileId) {
    throw new Error("ימות המשיח (FileAction): לא התקבל מזהה קובץ להמשך השליחה");
  }
  await callYemot("UploadTextFile", {
    what: `${extensionPath}/${fileId}-Title.tts`,
    contents: systemCode,
  }, (json) => json.responseStatus === "OK");
  const callJson = await callYemot("CallExtensionBridging", {
    phones: phone,
  }, (json) => json.responseStatus === "OK");

  const nowIso = new Date().toISOString();
  let sentAtError: any = null;
  if (idx < 0) {
    const { error } = await supabaseAdmin.from("systems").update({ voice_message_sent_at: nowIso }).eq("id", systemId);
    sentAtError = error;
  } else {
    const next = additional.slice();
    next[idx] = { ...(next[idx] ?? {}), phone: rawPhone, sent_at: nowIso };
    const { error } = await supabaseAdmin.from("systems").update({ additional_caller_phones: next } as any).eq("id", systemId);
    sentAtError = error;
  }
  if (sentAtError) throw new Error(sentAtError.message);

  return {
    ok: true,
    campaignId: callJson?.CampaignId ?? callJson?.campaignId ?? null,
    sentAt: nowIso,
  };
}

// Public entry point: runs the core send, and always logs the attempt
// (success or failure) to voice_message_log for the admin log view.
async function runYemotVoiceSend(
  supabaseAdmin: any,
  systemId: string,
  phoneIndex: number,
  sendMode: "manual" | "auto" | "queue" = "manual",
  userId?: string | null,
) {
  let phoneForLog: string | null = null;
  let statusForLog: string | null = null;
  let systemCodeForLog: string | null = null;
  try {
    const { data: sysRow } = await supabaseAdmin
      .from("systems")
      .select("system_code, status, caller_phone, phone, additional_caller_phones")
      .eq("id", systemId)
      .maybeSingle();
    if (sysRow) {
      systemCodeForLog = (sysRow as any).system_code ?? null;
      statusForLog = (sysRow as any).status ?? null;
      if (phoneIndex < 0) {
        phoneForLog = (sysRow as any).caller_phone || (sysRow as any).phone || null;
      } else {
        const additional = normalizeAdditionalCallerPhones((sysRow as any).additional_caller_phones);
        phoneForLog = additional[phoneIndex]?.phone ?? null;
      }
    }
  } catch {
    // Best-effort context for the log only; never blocks the actual send.
  }

  try {
    const result = await runYemotVoiceSendInner(supabaseAdmin, systemId, phoneIndex);
    await supabaseAdmin.from("voice_message_log").insert({
      system_id: systemId,
      system_code: systemCodeForLog,
      phone: phoneForLog,
      phone_index: phoneIndex,
      status_key: statusForLog,
      send_mode: sendMode,
      success: true,
      created_by: userId ?? null,
    }).then(() => {}, () => {});
    return result;
  } catch (e: any) {
    await supabaseAdmin.from("voice_message_log").insert({
      system_id: systemId,
      system_code: systemCodeForLog,
      phone: phoneForLog,
      phone_index: phoneIndex,
      status_key: statusForLog,
      send_mode: sendMode,
      success: false,
      error_message: String(e?.message ?? e).slice(0, 500),
      created_by: userId ?? null,
    }).then(() => {}, () => {});
    throw e;
  }
}

// Sends to every caller (primary + additional) who hasn't received the
// message yet for this system. Used by the automatic status-triggered send
// and by the queued/cron sender. Never throws — collects per-target results.
async function autoSendUnsentVoiceMessages(supabaseAdmin: any, systemId: string, sendMode: "auto" | "queue" | "manual" = "auto", userId?: string | null) {
  const { data: sysRow, error: sysErr } = await supabaseAdmin
    .from("systems")
    .select("caller_phone, phone, voice_message_sent_at, additional_caller_phones")
    .eq("id", systemId)
    .maybeSingle();
  if (sysErr || !sysRow) return { ok: 0, fail: 0, targets: 0 };
  const sys = sysRow as any;
  const additional = normalizeAdditionalCallerPhones(sys.additional_caller_phones);

  const targets: number[] = [];
  if ((sys.caller_phone || sys.phone) && !sys.voice_message_sent_at) targets.push(-1);
  additional.forEach((p, i) => { if (p?.phone && !p.sent_at) targets.push(i); });

  let ok = 0, fail = 0;
  for (const phoneIndex of targets) {
    try {
      await runYemotVoiceSend(supabaseAdmin, systemId, phoneIndex, sendMode, userId);
      ok++;
    } catch {
      fail++;
    }
  }
  return { ok, fail, targets: targets.length };
}

// Called right after a status change in updateSystem. If the new status is
// configured for automatic voice sending, either sends immediately (if
// within the configured hour window) or schedules it for the next window.
async function maybeScheduleOrSendAutoVoice(supabaseAdmin: any, systemId: string, statusKey: string) {
  try {
    const settings = await readStatusSettings(supabaseAdmin);
    const cur = settings.find((r) => r.status_key === statusKey);
    if (!cur?.enables_voice_message || cur.voice_send_mode !== "auto") {
      console.log(`[auto-voice] system=${systemId} status=${statusKey} -> not auto (enables=${cur?.enables_voice_message} mode=${cur?.voice_send_mode})`);
      return;
    }

    const now = new Date();
    const withinWindow = isWithinIsraelWindow(now, cur.auto_send_start_hour, cur.auto_send_end_hour);
    console.log(`[auto-voice] system=${systemId} status=${statusKey} nowUTC=${now.toISOString()} israelHour=${getIsraelHour(now)} window=${cur.auto_send_start_hour}-${cur.auto_send_end_hour} within=${withinWindow}`);
    if (withinWindow) {
      await supabaseAdmin.from("systems").update({ pending_voice_send_at: null }).eq("id", systemId);
      const result = await autoSendUnsentVoiceMessages(supabaseAdmin, systemId, "auto");
      console.log(`[auto-voice] system=${systemId} sent immediately, result=${JSON.stringify(result)}`);
    } else {
      const nextStart = nextIsraelWindowStart(now, cur.auto_send_start_hour);
      await supabaseAdmin.from("systems").update({ pending_voice_send_at: nextStart.toISOString() }).eq("id", systemId);
      console.log(`[auto-voice] system=${systemId} queued for ${nextStart.toISOString()}`);
    }
  } catch (e: any) {
    console.log(`[auto-voice] system=${systemId} status=${statusKey} ERROR: ${e?.message}`);
    // Never let auto-voice-send scheduling break the status update itself.
  }
}

// Cron entry point: processes every system whose scheduled auto-send time
// has arrived. Re-validates the status is still auto+enabled and we're still
// within its window before actually sending (status may have changed since
// it was queued).
export async function processPendingVoiceSends(supabaseAdmin: any) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("systems")
    .select("id, status, pending_voice_send_at")
    .not("pending_voice_send_at", "is", null)
    .lte("pending_voice_send_at", nowIso)
    .limit(200);
  if (error) throw new Error(error.message);

  const settings = await readStatusSettings(supabaseAdmin);
  const settingsByKey = new Map(settings.map((s) => [s.status_key, s]));
  const now = new Date();
  let sent = 0, skipped = 0, requeued = 0;

  for (const row of (due ?? []) as any[]) {
    const cur = settingsByKey.get(row.status);
    if (!cur?.enables_voice_message || cur.voice_send_mode !== "auto") {
      await supabaseAdmin.from("systems").update({ pending_voice_send_at: null }).eq("id", row.id);
      skipped++;
      continue;
    }
    if (!isWithinIsraelWindow(now, cur.auto_send_start_hour, cur.auto_send_end_hour)) {
      const nextStart = nextIsraelWindowStart(now, cur.auto_send_start_hour);
      await supabaseAdmin.from("systems").update({ pending_voice_send_at: nextStart.toISOString() }).eq("id", row.id);
      requeued++;
      continue;
    }
    await supabaseAdmin.from("systems").update({ pending_voice_send_at: null }).eq("id", row.id);
    await autoSendUnsentVoiceMessages(supabaseAdmin, row.id, "queue");
    sent++;
  }
  return { ok: true, processed: (due ?? []).length, sent, skipped, requeued };
}

// Lightweight, authenticated, client-callable trigger for the same queue
// processor above. Used as a free alternative to a frequent Vercel cron
// (which requires the Pro plan): the dashboard calls this every few minutes
// while someone has it open, piggy-backing on normal staff activity during
// business hours. Throttled so many simultaneously-open dashboards don't
// hammer Yemot with duplicate work.
export const pokeVoiceQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      checkRateLimit("global:pokeVoiceQueue", 1, 4 * 60_000);
    } catch {
      return { ok: true, skipped: true };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await processPendingVoiceSends(supabaseAdmin);
    } catch {
      return { ok: false };
    }
  });

// Manually send everyone still-unsent on a specific queued system right now,
// bypassing the configured hour window. Used by the "send now" button on the
// pending-queue view (manager dashboard).
// Lets an admin directly override when a queued system's voice message will
// send (instead of waiting for the status's configured hour window).
export const rescheduleVoicePending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { systemId: string; sendAt: string | null }) =>
    z.object({ systemId: z.string().uuid(), sendAt: z.string().datetime().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "settings_manage"))) {
      throw new Error("אין הרשאה");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("systems").update({ pending_voice_send_at: data.sendAt }).eq("id", data.systemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const manualSendPendingVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { systemId: string }) => z.object({ systemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { hasPermission } = await import("@/lib/permissions.server");
    if (!(await hasPermission(context.userId, "settings_manage"))) {
      throw new Error("אין הרשאה");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("systems").update({ pending_voice_send_at: null }).eq("id", data.systemId);
    return autoSendUnsentVoiceMessages(supabaseAdmin, data.systemId, "manual", context.userId);
  });

export const sendVoiceMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { systemId: string; phoneIndex?: number }) =>
    z.object({
      systemId: z.string().uuid(),
      // -1 (or omitted) = primary caller_phone; 0..N = index in additional_caller_phones.
      phoneIndex: z.number().int().min(-1).max(50).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const idx = typeof data.phoneIndex === "number" ? data.phoneIndex : -1;
    return runYemotVoiceSend(supabaseAdmin, data.systemId, idx, "manual", context.userId);
  });

// ============= Additional caller phones =============

// Additional caller phones live in `additional_caller_phones` (jsonb array).
// These mutations use the admin client after gating on writes so they never
// silently drop the update when the caller isn't the assigned agent but is
// allowed to edit systems.

export const addAdditionalCallerPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { systemId: string; phone: string }) =>
    z.object({ systemId: z.string().uuid(), phone: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sys, error: loadError } = await supabaseAdmin
      .from("systems")
      .select("additional_caller_phones")
      .eq("id", data.systemId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sys) throw new Error("המערכת לא נמצאה");
    const arr = normalizeAdditionalCallerPhones((sys as any).additional_caller_phones);
    if (arr.length >= 20) throw new Error("ניתן להוסיף עד 20 מספרי פונה נוספים");
    const phone = sanitizeText(data.phone).trim();
    if (!phone) throw new Error("מספר ריק");
    const next = [...arr, { phone }];
    const { data: updated, error } = await supabaseAdmin
      .from("systems")
      .update({ additional_caller_phones: next } as any)
      .eq("id", data.systemId)
      .select("additional_caller_phones")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("שמירת המספר נכשלה");
    return { ok: true, additional_caller_phones: (updated as any).additional_caller_phones };
  });

export const updateAdditionalCallerPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { systemId: string; index: number; phone: string }) =>
    z.object({ systemId: z.string().uuid(), index: z.number().int().min(0).max(50), phone: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sys, error: loadError } = await supabaseAdmin
      .from("systems")
      .select("additional_caller_phones")
      .eq("id", data.systemId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sys) throw new Error("המערכת לא נמצאה");
    const arr = normalizeAdditionalCallerPhones((sys as any).additional_caller_phones);
    if (!arr[data.index]) throw new Error("מספר לא נמצא");
    const phone = sanitizeText(data.phone).trim();
    if (!phone) throw new Error("מספר ריק");
    const next = arr.slice();
    next[data.index] = { ...next[data.index], phone };
    const { error } = await supabaseAdmin.from("systems").update({ additional_caller_phones: next } as any).eq("id", data.systemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeAdditionalCallerPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { systemId: string; index: number }) =>
    z.object({ systemId: z.string().uuid(), index: z.number().int().min(0).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureCanWrite(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sys, error: loadError } = await supabaseAdmin
      .from("systems")
      .select("additional_caller_phones")
      .eq("id", data.systemId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sys) throw new Error("המערכת לא נמצאה");
    const arr = normalizeAdditionalCallerPhones((sys as any).additional_caller_phones);
    if (!arr[data.index]) return { ok: true };
    const next = arr.slice();
    next.splice(data.index, 1);
    const { error } = await supabaseAdmin.from("systems").update({ additional_caller_phones: next } as any).eq("id", data.systemId);
    if (error) throw new Error(error.message);
    return { ok: true };
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
