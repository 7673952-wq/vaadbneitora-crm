import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";
import { fromSupabase, AppError } from "@/lib/errors";
import { sanitizeText } from "@/lib/sanitize";

export type CrmRole = "viewer" | "agent" | "admin" | "super_admin";

export type CrmSummary = {
  key: string;
  name: string;
  color: string;
  icon: string | null;
  idLabel: string;
  recordTable: string;
  sortOrder: number;
  isActive: boolean;
  myRole: CrmRole | null;
};

const ROLES = ["viewer", "agent", "admin", "super_admin"] as const;

async function isGlobalSuperAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  return (data ?? []).some((r: any) => r.role === "super_admin");
}

async function assertCrmAdmin(context: { supabase: any; userId: string }) {
  const { assertAnyPermission } = await import("@/lib/permissions.server");
  await assertAnyPermission(context.userId, ["settings_manage", "users_manage"]);
}

/** All CRMs the signed-in user can see, with their per-CRM role. */
export const listMyCrms = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }): Promise<CrmSummary[]> => {
    const [{ data: crms, error }, { data: memberships }] = await Promise.all([
      context.supabase.from("crms").select("*").order("sort_order", { ascending: true }),
      context.supabase.from("crm_user_roles").select("crm_key, role").eq("user_id", context.userId),
    ]);
    if (error) throw fromSupabase(error);
    const superAdmin = await isGlobalSuperAdmin(context);
    const roleByCrm = new Map<string, CrmRole>(
      (memberships ?? []).map((m: any) => [m.crm_key as string, m.role as CrmRole]),
    );
    return (crms ?? [])
      .map((c: any) => ({
        key: c.key as string,
        name: c.name as string,
        color: c.color as string,
        icon: (c.icon ?? null) as string | null,
        idLabel: c.id_label as string,
        recordTable: c.record_table as string,
        sortOrder: c.sort_order as number,
        isActive: c.is_active as boolean,
        myRole: superAdmin ? ("super_admin" as CrmRole) : (roleByCrm.get(c.key) ?? null),
      }))
      .filter((c: CrmSummary) => c.myRole !== null && (c.isActive || c.myRole === "super_admin"));
  });

export const upsertCrm = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((input: unknown) =>
    z
      .object({
        key: z.string().trim().min(2).max(32).regex(/^[a-z0-9_]+$/, "מזהה באנגלית קטנה בלבד"),
        name: z.string().trim().min(1).max(80),
        color: z.string().trim().max(20).default("#2563eb"),
        idLabel: z.string().trim().min(1).max(40).default("מספר מערכת"),
        sortOrder: z.number().int().min(0).max(999).default(0),
        isActive: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCrmAdmin(context);
    const { error } = await context.supabase.from("crms").upsert(
      {
        key: data.key,
        name: sanitizeText(data.name),
        color: data.color,
        id_label: sanitizeText(data.idLabel),
        record_table: data.key === "yemot" ? "systems" : "crm_records",
        sort_order: data.sortOrder,
        is_active: data.isActive,
      },
      { onConflict: "key" },
    );
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const deleteCrm = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((input: unknown) => z.object({ key: z.string().trim().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCrmAdmin(context);
    if (data.key === "yemot") throw new AppError("לא ניתן למחוק את המערכת הראשית");
    const { error } = await context.supabase.from("crms").delete().eq("key", data.key);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

/** Membership matrix: every user and their role in every CRM. */
export const listCrmMembers = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    await assertCrmAdmin(context);
    const [{ data: profiles, error }, { data: rows }] = await Promise.all([
      context.supabase.from("profiles").select("id, display_name").order("display_name"),
      context.supabase.from("crm_user_roles").select("user_id, crm_key, role"),
    ]);
    if (error) throw fromSupabase(error);
    return {
      users: (profiles ?? []).map((p: any) => ({ id: p.id as string, displayName: p.display_name as string })),
      memberships: (rows ?? []).map((r: any) => ({
        userId: r.user_id as string,
        crmKey: r.crm_key as string,
        role: r.role as CrmRole,
      })),
    };
  });

export const setCrmUserRole = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        crmKey: z.string().trim().min(1),
        role: z.enum(ROLES).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "permissions_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.role === null) {
      const { error } = await supabaseAdmin
        .from("crm_user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("crm_key", data.crmKey);
      if (error) throw fromSupabase(error);
      return { ok: true };
    }
    const { error } = await supabaseAdmin
      .from("crm_user_roles")
      .upsert({ user_id: data.userId, crm_key: data.crmKey, role: data.role }, { onConflict: "user_id,crm_key" });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

/* ===================== Kosher instructions ===================== */

export const listKosherInstructions = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("kosher_instructions")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw fromSupabase(error);
    return (data ?? []).map((r: any) => ({
      id: r.id as string,
      title: r.title as string,
      body: r.body as string,
      sortOrder: r.sort_order as number,
      updatedAt: r.updated_at as string,
      updatedByName: (r.updated_by_name ?? null) as string | null,
    }));
  });

export const upsertKosherInstruction = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20000).default(""),
        sortOrder: z.number().int().min(0).max(999).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "settings_manage");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();
    const row = {
      ...(data.id ? { id: data.id } : {}),
      title: sanitizeText(data.title),
      body: data.body,
      sort_order: data.sortOrder,
      updated_by: context.userId,
      updated_by_name: (prof as any)?.display_name ?? null,
    };
    const { error } = await context.supabase.from("kosher_instructions").upsert(row);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const deleteKosherInstruction = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "settings_manage");
    const { error } = await context.supabase.from("kosher_instructions").delete().eq("id", data.id);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });
