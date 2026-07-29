import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fromSupabase, AppError } from "@/lib/errors";
import { sanitizeText } from "@/lib/sanitize";

export type CrmRecord = {
  id: string;
  crmKey: string;
  recordCode: string;
  name: string;
  status: string;
  assignedAgentId: string | null;
  phone: string | null;
  callerPhone: string | null;
  email: string | null;
  source: string | null;
  notes: string | null;
  reminderAt: string | null;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function mapRecord(r: any): CrmRecord {
  return {
    id: r.id,
    crmKey: r.crm_key,
    recordCode: r.record_code,
    name: r.name ?? "",
    status: r.status,
    assignedAgentId: r.assigned_agent_id ?? null,
    phone: r.phone ?? null,
    callerPhone: r.caller_phone ?? null,
    email: r.email ?? null,
    source: r.source ?? null,
    notes: r.notes ?? null,
    reminderAt: r.reminder_at ?? null,
    custom: (r.custom ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ============ field definitions ============ */

export const listFieldDefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ crmKey: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("crm_field_defs")
      .select("*")
      .eq("crm_key", data.crmKey)
      .order("sort_order", { ascending: true });
    if (error) throw fromSupabase(error);
    return (rows ?? []).map((r: any) => ({
      id: r.id as string,
      crmKey: r.crm_key as string,
      fieldKey: r.field_key as string,
      label: r.label as string,
      fieldType: r.field_type as string,
      options: (r.options ?? []) as string[],
      required: r.required as boolean,
      showInTable: r.show_in_table as boolean,
      sortOrder: r.sort_order as number,
    }));
  });

export const upsertFieldDef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        crmKey: z.string().min(1),
        fieldKey: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, "מזהה שדה באנגלית קטנה"),
        label: z.string().trim().min(1).max(80),
        fieldType: z.enum(["text", "number", "date", "select", "textarea", "phone", "email", "checkbox"]),
        options: z.array(z.string().trim().max(80)).max(50).default([]),
        required: z.boolean().default(false),
        showInTable: z.boolean().default(false),
        sortOrder: z.number().int().min(0).max(999).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "settings_manage");
    const { error } = await context.supabase.from("crm_field_defs").upsert(
      {
        ...(data.id ? { id: data.id } : {}),
        crm_key: data.crmKey,
        field_key: data.fieldKey,
        label: sanitizeText(data.label),
        field_type: data.fieldType,
        options: data.options,
        required: data.required,
        show_in_table: data.showInTable,
        sort_order: data.sortOrder,
      },
      { onConflict: "crm_key,field_key" },
    );
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const deleteFieldDef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "settings_manage");
    const { error } = await context.supabase.from("crm_field_defs").delete().eq("id", data.id);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

/* ============ records ============ */

export const listRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ crmKey: z.string().min(1), search: z.string().max(120).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("crm_records")
      .select("*")
      .eq("crm_key", data.crmKey)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw fromSupabase(error);
    const list = (rows ?? []).map(mapRecord);
    const q = data.search?.trim().toLowerCase();
    if (!q) return list;
    const digits = q.replace(/\D/g, "");
    return list.filter((r) => {
      const hay = [r.recordCode, r.name, r.status, r.email, r.source, r.notes, JSON.stringify(r.custom)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(q)) return true;
      if (digits) {
        const phones = `${r.phone ?? ""}${r.callerPhone ?? ""}`.replace(/\D/g, "");
        if (phones.includes(digits)) return true;
      }
      return false;
    });
  });

export const getRecord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("crm_records")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw fromSupabase(error);
    if (!row) throw new AppError("הפניה לא נמצאה");
    const [{ data: notes }, { data: activity }] = await Promise.all([
      context.supabase
        .from("crm_record_notes")
        .select("*")
        .eq("record_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("crm_record_activity")
        .select("*")
        .eq("record_id", data.id)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    return {
      record: mapRecord(row),
      notes: (notes ?? []).map((n: any) => ({
        id: n.id as string,
        body: n.body as string,
        authorName: (n.author_name ?? null) as string | null,
        createdAt: n.created_at as string,
      })),
      activity: (activity ?? []).map((a: any) => ({
        id: a.id as string,
        action: a.action as string,
        field: (a.field ?? null) as string | null,
        oldValue: (a.old_value ?? null) as string | null,
        newValue: (a.new_value ?? null) as string | null,
        actorName: (a.actor_display_name ?? null) as string | null,
        createdAt: a.created_at as string,
      })),
    };
  });

const recordInput = z.object({
  crmKey: z.string().min(1),
  recordCode: z.string().trim().min(1).max(60),
  name: z.string().trim().max(200).default(""),
  status: z.string().trim().max(60).default("open"),
  phone: z.string().trim().max(40).nullable().default(null),
  callerPhone: z.string().trim().max(40).nullable().default(null),
  email: z.string().trim().max(200).nullable().default(null),
  source: z.string().trim().max(80).nullable().default(null),
  notes: z.string().max(5000).nullable().default(null),
  custom: z.record(z.string(), z.unknown()).default({}),
});

async function actorName(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", context.userId)
    .maybeSingle();
  return (data as any)?.display_name ?? null;
}

export const createRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recordInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("crm_records")
      .insert({
        crm_key: data.crmKey,
        record_code: sanitizeText(data.recordCode),
        name: sanitizeText(data.name),
        status: data.status,
        phone: data.phone,
        caller_phone: data.callerPhone,
        email: data.email,
        source: data.source,
        notes: data.notes,
        custom: data.custom,
        created_by: context.userId,
        assigned_agent_id: context.userId,
      })
      .select("*")
      .single();
    if (error) throw fromSupabase(error);
    await context.supabase.from("crm_record_activity").insert({
      record_id: (row as any).id,
      crm_key: data.crmKey,
      actor_id: context.userId,
      actor_display_name: await actorName(context),
      action: "create",
    });
    return mapRecord(row);
  });

export const updateRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: recordInput.partial().omit({ crmKey: true }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: before, error: readErr } = await context.supabase
      .from("crm_records")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw fromSupabase(readErr);
    if (!before) throw new AppError("הפניה לא נמצאה");

    const patch: Record<string, unknown> = {};
    const p = data.patch;
    if (p.recordCode !== undefined) patch.record_code = sanitizeText(p.recordCode);
    if (p.name !== undefined) patch.name = sanitizeText(p.name);
    if (p.status !== undefined) patch.status = p.status;
    if (p.phone !== undefined) patch.phone = p.phone;
    if (p.callerPhone !== undefined) patch.caller_phone = p.callerPhone;
    if (p.email !== undefined) patch.email = p.email;
    if (p.source !== undefined) patch.source = p.source;
    if (p.notes !== undefined) patch.notes = p.notes;
    if (p.custom !== undefined) patch.custom = p.custom;

    const { data: row, error } = await context.supabase
      .from("crm_records")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw fromSupabase(error);

    const name = await actorName(context);
    const logs = Object.keys(patch)
      .filter((k) => String((before as any)[k] ?? "") !== String((row as any)[k] ?? ""))
      .map((k) => ({
        record_id: data.id,
        crm_key: (before as any).crm_key,
        actor_id: context.userId,
        actor_display_name: name,
        action: "update",
        field: k,
        old_value: String((before as any)[k] ?? ""),
        new_value: String((row as any)[k] ?? ""),
      }));
    if (logs.length) await context.supabase.from("crm_record_activity").insert(logs);
    return mapRecord(row);
  });

export const deleteRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("crm_records").delete().eq("id", data.id);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const addRecordNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ recordId: z.string().uuid(), crmKey: z.string().min(1), body: z.string().trim().min(1).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("crm_record_notes").insert({
      record_id: data.recordId,
      crm_key: data.crmKey,
      author_id: context.userId,
      author_name: await actorName(context),
      body: data.body,
    });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });
