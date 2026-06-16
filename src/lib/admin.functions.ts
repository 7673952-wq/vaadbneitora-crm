import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { userId: string }) {
  const { assertAdminUserId } = await import("@/lib/admin-role.server");
  await assertAdminUserId(context.userId);
}

async function assertSuperAdmin(context: { userId: string }) {
  const { assertSuperAdminUserId } = await import("@/lib/admin-role.server");
  await assertSuperAdminUserId(context.userId);
}

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; display_name: string; role: "admin" | "agent" | "super_admin" }) =>
    z.object({
      email: z.string().email(),
      password: z.string().min(6).max(72),
      display_name: z.string().min(1).max(100),
      role: z.enum(["admin", "agent", "super_admin"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password: data.password, email_confirm: true,
      user_metadata: { display_name: data.display_name },
    });
    if (error) throw new Error(error.message);
    const [{ error: profileError }, { error: roleError }] = await Promise.all([
      supabaseAdmin.from("profiles").upsert({ id: created.user.id, display_name: data.display_name }),
      supabaseAdmin.from("user_roles").upsert({ user_id: created.user.id, role: data.role }),
    ]);
    if (profileError) throw new Error(profileError.message);
    if (roleError) throw new Error(roleError.message);
    return { id: created.user.id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (data.user_id === context.userId) throw new Error("לא ניתן למחוק את עצמך");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: "admin" | "agent" | "super_admin" }) =>
    z.object({ user_id: z.string().uuid(), role: z.enum(["admin", "agent", "super_admin"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const rows: { user_id: string; role: "admin" | "agent" | "super_admin" }[] =
      data.role === "super_admin"
        ? [{ user_id: data.user_id, role: "admin" }, { user_id: data.user_id, role: "super_admin" }]
        : [{ user_id: data.user_id, role: data.role }];
    const { error } = await supabaseAdmin.from("user_roles").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateUserDisplayName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; display_name: string }) =>
    z.object({ user_id: z.string().uuid(), display_name: z.string().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles").update({ display_name: data.display_name }).eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.auth.admin.updateUserById(data.user_id, { user_metadata: { display_name: data.display_name } });
    return { ok: true };
  });

export const updateUserEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; email: string }) =>
    z.object({ user_id: z.string().uuid(), email: z.string().email() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { email: data.email, email_confirm: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; password: string }) =>
    z.object({ user_id: z.string().uuid(), password: z.string().min(6).max(72) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isAdminUserId, isSuperAdminUserId } = await import("@/lib/admin-role.server");
    const { data } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId);
    const roles = (data ?? []).map((r: any) => r.role);
    const isSuperAdmin = roles.includes("super_admin") || await isSuperAdminUserId(context.userId);
    const isAdmin = isSuperAdmin || roles.includes("admin") || await isAdminUserId(context.userId);
    if (isSuperAdmin && !roles.includes("super_admin")) roles.push("super_admin");
    if (isAdmin && !roles.includes("admin")) roles.push("admin");
    return { userId: context.userId, roles, isAdmin, isSuperAdmin };
  });

export const listUsersForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profiles }, { data: roles }, { data: usersList }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name, created_at"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.auth.admin.listUsers(),
    ]);
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    const profileMap = new Map<string, any>();
    (profiles ?? []).forEach((p: any) => profileMap.set(p.id, p));
    return (usersList?.users ?? []).map((u: any) => {
      const p = profileMap.get(u.id);
      return {
        id: u.id,
        display_name: p?.display_name ?? (u.user_metadata?.display_name as string | undefined) ?? u.email?.split("@")[0] ?? "משתמש",
        email: u.email ?? "",
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: p?.created_at ?? u.created_at,
        roles: roleMap.get(u.id) ?? [],
      };
    });
  });

export const listStatusSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("status_settings")
      .select("status_key, label, tone, sort_order, is_custom, is_handled, assigned_agent_ids")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertStatusSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status_key: string; label: string; tone: string; sort_order?: number; is_custom?: boolean; is_handled?: boolean; assigned_agent_ids?: string[] }) =>
    z.object({
      status_key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "מפתח חייב להכיל אותיות אנגליות קטנות, ספרות וקו תחתון בלבד"),
      label: z.string().min(1).max(100),
      tone: z.string().min(1).max(40),
      sort_order: z.number().int().min(0).max(10000).optional(),
      is_custom: z.boolean().optional(),
      is_handled: z.boolean().optional(),
      assigned_agent_ids: z.array(z.string().uuid()).max(50).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {
      status_key: data.status_key,
      label: data.label,
      tone: data.tone,
      sort_order: data.sort_order ?? 0,
      is_custom: data.is_custom ?? false,
    };
    if (data.is_handled !== undefined) patch.is_handled = data.is_handled;
    if (data.assigned_agent_ids !== undefined) patch.assigned_agent_ids = data.assigned_agent_ids;
    const { error } = await supabaseAdmin.from("status_settings").upsert(patch);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteStatusSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status_key: string }) =>
    z.object({ status_key: z.string().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Only allow deleting custom statuses (not the built-in enum values).
    const { data: row } = await supabaseAdmin.from("status_settings").select("is_custom").eq("status_key", data.status_key).maybeSingle();
    if (!row?.is_custom) throw new Error("לא ניתן למחוק סטטוס מובנה");
    const { error } = await supabaseAdmin.from("status_settings").delete().eq("status_key", data.status_key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Auto-snooze settings =============

const AUTO_SNOOZE_KEY = "auto_snooze";

export const getAutoSnoozeSetting = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", AUTO_SNOOZE_KEY).maybeSingle();
    return (data?.value as { unit: "day"|"week"|"month"|"date"; date?: string|null; threshold_days: number } | null) ?? null;
  });

export const setAutoSnoozeSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { unit: "day"|"week"|"month"|"date"; date?: string|null; threshold_days: number }) =>
    z.object({
      unit: z.enum(["day","week","month","date"]),
      date: z.string().datetime().nullable().optional(),
      threshold_days: z.number().int().min(0).max(3650),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: AUTO_SNOOZE_KEY,
      value: data,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function computeSnoozeUntil(unit: string, date?: string|null): string {
  const now = new Date();
  if (unit === "day") now.setDate(now.getDate() + 1);
  else if (unit === "week") now.setDate(now.getDate() + 7);
  else if (unit === "month") now.setMonth(now.getMonth() + 1);
  else if (unit === "date") {
    if (!date) throw new Error("יש לבחור תאריך");
    return new Date(date).toISOString();
  }
  return now.toISOString();
}

