import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AppError, fromSupabase } from "@/lib/errors";
import { sanitizeText } from "@/lib/sanitize";
import {
  deleteStatusSettingStable,
  readStatusSettings,
  reorderStatusSettingsStable,
  upsertStatusSettingStable,
} from "@/lib/status-settings";

// All authorization goes through `assertRole` / `hasRole` from
// @/lib/permissions.server — no other mechanism is used in this file.
async function assertAdmin(context: { userId: string }) {
  const { assertAnyPermission } = await import("@/lib/permissions.server");
  await assertAnyPermission(context.userId, ["settings_manage", "users_manage", "permissions_manage", "backup_manage"]);
}

async function assertSuperAdmin(context: { userId: string }) {
  const { assertAnyPermission } = await import("@/lib/permissions.server");
  await assertAnyPermission(context.userId, ["users_manage", "permissions_manage"]);
}

async function assertPermission(context: { userId: string }, permission: import("@/lib/permissions.server").PermissionKey, crmKey?: string) {
  const { assertPermission } = await import("@/lib/permissions.server");
  await assertPermission(context.userId, permission, crmKey ?? "yemot");
}

/**
 * Settings under the "כללי" tab apply to every CRM, so the permission may come
 * from ANY CRM the user belongs to (not just "yemot").
 */
async function assertGlobalPermission(context: { userId: string }, permission: import("@/lib/permissions.server").PermissionKey) {
  const { assertPermissionInAnyCrm } = await import("@/lib/permissions.server");
  await assertPermissionInAnyCrm(context.userId, permission);
}

async function assertAnyPermission(context: { userId: string }, permissions: import("@/lib/permissions.server").PermissionKey[]) {
  const { assertAnyPermission } = await import("@/lib/permissions.server");
  await assertAnyPermission(context.userId, permissions);
}

const ROLES = ["viewer", "agent", "admin", "super_admin"] as const;
const PERMISSION_KEYS = [
  "systems_read", "systems_write", "systems_delete", "system_name_edit", "system_code_edit",
  "status_change", "agent_transfer", "notes_write", "emails_send", "files_manage",
  "import_export", "series_manage", "backup_manage", "audit_view", "settings_manage", "users_manage", "permissions_manage",
  "history_edit",
] as const;

function isSchemaCacheMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null | undefined;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`;
  return e?.code === "PGRST205"
    || text.includes("schema cache")
    || text.includes("Could not find the table")
    || text.includes("relation") && text.includes("does not exist");
}

const DEFAULT_ROLE_PERMISSION_ROWS = ROLES.flatMap((role) => PERMISSION_KEYS.map((permission) => ({
  role,
  permission,
  allowed: role === "super_admin"
    || (role === "admin" && ["systems_read", "systems_write", "system_name_edit", "status_change", "agent_transfer", "notes_write", "emails_send", "files_manage", "import_export", "series_manage", "backup_manage", "settings_manage"].includes(permission))
    || (role === "agent" && ["systems_read", "systems_write", "status_change", "agent_transfer", "notes_write", "emails_send", "files_manage"].includes(permission))
    || (role === "viewer" && permission === "systems_read"),
}))) as { role: string; permission: string; allowed: boolean }[];
const PERMISSION_SETTINGS_KEY = "permission_settings";

type PermissionSettingsValue = {
  rolePermissions: Array<{ role: string; permission: string; allowed: boolean; updated_at?: string; updated_by?: string | null }>;
  userPermissions: Array<{ user_id: string; permission: string; allowed: boolean; updated_at?: string; updated_by?: string | null }>;
};

function normalizePermissionSettings(value: unknown): PermissionSettingsValue {
  const v = (value ?? {}) as Partial<PermissionSettingsValue>;
  const rolePermissions = Array.isArray(v.rolePermissions) && v.rolePermissions.length
    ? v.rolePermissions
        .filter((r: any) => ROLES.includes(r?.role) && PERMISSION_KEYS.includes(r?.permission) && typeof r?.allowed === "boolean")
        .map((r: any) => ({ role: r.role, permission: r.permission, allowed: r.allowed, updated_at: r.updated_at, updated_by: r.updated_by ?? null }))
    : DEFAULT_ROLE_PERMISSION_ROWS;
  const userPermissions = Array.isArray(v.userPermissions)
    ? v.userPermissions
        .filter((r: any) => typeof r?.user_id === "string" && PERMISSION_KEYS.includes(r?.permission) && typeof r?.allowed === "boolean")
        .map((r: any) => ({ user_id: r.user_id, permission: r.permission, allowed: r.allowed, updated_at: r.updated_at, updated_by: r.updated_by ?? null }))
    : [];
  return { rolePermissions, userPermissions };
}

async function readPermissionSettings(supabaseAdmin: any): Promise<PermissionSettingsValue> {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", PERMISSION_SETTINGS_KEY)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw fromSupabase(error);
  return normalizePermissionSettings((data as any)?.value);
}

async function writePermissionSettings(supabaseAdmin: any, value: PermissionSettingsValue, userId: string) {
  const { error } = await supabaseAdmin.from("app_settings").upsert({
    key: PERMISSION_SETTINGS_KEY,
    value,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });
  if (error) throw fromSupabase(error);
}
async function seedMissingRolePermissions() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const defaults: Record<(typeof ROLES)[number], Partial<Record<(typeof PERMISSION_KEYS)[number], boolean>>> = {
    viewer: { systems_read: true },
    agent: { systems_read: true, systems_write: true, status_change: true, agent_transfer: true, notes_write: true, emails_send: true, files_manage: true },
    admin: { systems_read: true, systems_write: true, status_change: true, agent_transfer: true, notes_write: true, emails_send: true, files_manage: true, import_export: true, series_manage: true, backup_manage: true, settings_manage: true, audit_view: true },
    super_admin: Object.fromEntries(PERMISSION_KEYS.map((p) => [p, true])) as Record<(typeof PERMISSION_KEYS)[number], boolean>,
  };
  const rows = ROLES.flatMap((role) => PERMISSION_KEYS.map((permission) => ({
    role,
    permission,
    allowed: defaults[role][permission] === true,
  })));
  await supabaseAdmin.from("role_permissions").upsert(rows, { onConflict: "role,permission", ignoreDuplicates: true } as any);
}

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; display_name: string; role: "admin" | "agent" | "super_admin" | "viewer" }) =>
    z.object({
      email: z.string().email(),
      password: z.string().min(6).max(72),
      display_name: z.string().min(1).max(100),
      role: z.enum(["admin", "agent", "super_admin", "viewer"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "users_manage");
    const displayName = sanitizeText(data.display_name);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password: data.password, email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw fromSupabase(error);
    const [{ error: profileError }, { error: roleError }] = await Promise.all([
      supabaseAdmin.from("profiles").upsert({ id: created.user.id, display_name: displayName }),
      supabaseAdmin.from("user_roles").upsert({ user_id: created.user.id, role: data.role }),
    ]);
    if (profileError) throw fromSupabase(profileError);
    if (roleError) throw fromSupabase(roleError);
    return { id: created.user.id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "users_manage");
    if (data.user_id === context.userId) throw new AppError("לא ניתן למחוק את עצמך", { code: "bad_request" });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: "admin" | "agent" | "super_admin" | "viewer" }) =>
    z.object({ user_id: z.string().uuid(), role: z.enum(["admin", "agent", "super_admin", "viewer"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const rows: { user_id: string; role: "admin" | "agent" | "super_admin" | "viewer" }[] =
      data.role === "super_admin"
        ? [{ user_id: data.user_id, role: "admin" }, { user_id: data.user_id, role: "super_admin" }]
        : [{ user_id: data.user_id, role: data.role }];
    const { error } = await supabaseAdmin.from("user_roles").insert(rows);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const updateUserDisplayName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; display_name: string }) =>
    z.object({ user_id: z.string().uuid(), display_name: z.string().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "users_manage");
    const displayName = sanitizeText(data.display_name);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles").update({ display_name: displayName }).eq("id", data.user_id);
    if (error) throw fromSupabase(error);
    await supabaseAdmin.auth.admin.updateUserById(data.user_id, { user_metadata: { display_name: displayName } });
    return { ok: true };
  });

export const updateUserEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; email: string }) =>
    z.object({ user_id: z.string().uuid(), email: z.string().email() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { email: data.email, email_confirm: true });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const updateUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; password: string }) =>
    z.object({ user_id: z.string().uuid(), password: z.string().min(6).max(72) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getUserPermissionMap, getGlobalPermissionMap, getCrmRoles } = await import("@/lib/permissions.server");
    const [{ data, error }, { data: prof }] = await Promise.all([
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
    ]);
    if (error) throw fromSupabase(error);
    const roles = (data ?? []).map((r: any) => r.role).filter((r: any) =>
      r === "super_admin" || r === "admin" || r === "agent" || r === "viewer",
    );
    const isSuperAdmin = roles.includes("super_admin");
    const yemotRoles = await getCrmRoles(context.userId, "yemot");
    const isAdmin = isSuperAdmin || yemotRoles.includes("admin") || yemotRoles.includes("super_admin");
    const isAgent = isAdmin || yemotRoles.includes("agent");
    // A user is "viewer" only when they have ONLY the viewer role (no agent/admin).
    const isViewer = !isAgent && roles.includes("viewer");
    if (isAdmin && !roles.includes("admin")) roles.push("admin");
    if (isAgent && !roles.includes("agent")) roles.push("agent");
    return {
      userId: context.userId,
      roles,
      isAdmin,
      isSuperAdmin,
      isAgent,
      isViewer,
      permissions: await getUserPermissionMap(context.userId),
      // Union across every CRM the user belongs to — drives the shared
      // "כללי" admin tab, which applies to all CRMs.
      globalPermissions: await getGlobalPermissionMap(context.userId),
      displayName: (prof as any)?.display_name ?? null,
    };
  });


export const listUsersForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertGlobalPermission(context, "users_manage");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hasPermission } = await import("@/lib/permissions.server");
    const rows = await readStatusSettings(supabaseAdmin);
    // Only admins who manage settings/permissions may see the raw voice
    // provider API key. Strip it for everyone else so it never leaves
    // the server.
    const canSeeSecrets =
      (await hasPermission(context.userId, "settings_manage")) ||
      (await hasPermission(context.userId, "permissions_manage"));
    if (canSeeSecrets) return rows;
    return rows.map((r) => ({ ...r, voice_message_api_key: "" }));
  });

export const listPendingVoiceSends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPermission(context, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    // Get all systems with pending voice sends or already sent
    const { data: systems, error } = await supabaseAdmin
      .from("systems")
      .select("id, system_code, status, pending_voice_send_at, voice_message_sent_at, caller_phone, phone, additional_caller_phones, created_at");
    
    if (error) throw new Error(error.message);
    
    // Enrich with status settings
    const settings = await readStatusSettings(supabaseAdmin);
    const settingsByKey = new Map(settings.map((s) => [s.status_key, s]));
    
    const pending = (systems ?? []).map((sys: any) => {
      const setting = settingsByKey.get(sys.status);
      const isPending = !!sys.pending_voice_send_at && !sys.voice_message_sent_at;
      const isSent = !!sys.voice_message_sent_at;
      
      return {
        id: sys.id,
        system_code: sys.system_code,
        status: sys.status,
        status_label: setting?.label || sys.status,
        pending_voice_send_at: sys.pending_voice_send_at,
        voice_message_sent_at: sys.voice_message_sent_at,
        caller_phone: sys.caller_phone || sys.phone,
        additional_phones: sys.additional_caller_phones || [],
        created_at: sys.created_at,
        isPending,
        isSent,
        voice_enabled: setting?.enables_voice_message || false,
      };
    });
    
    return { 
      total: pending.length,
      pending: pending.filter((p: any) => p.isPending && p.voice_enabled),
      sent_today: pending.filter((p: any) => p.isSent && p.voice_enabled && new Date(p.voice_message_sent_at).toDateString() === new Date().toDateString()),
      sent_all: pending.filter((p: any) => p.isSent && p.voice_enabled),
    };
  });

export const listVoiceMessageLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPermission(context, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("voice_message_log")
      .select("id, system_id, system_code, phone, phone_index, status_key, send_mode, success, error_message, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const upsertStatusSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status_key: string; label: string; tone: string; sort_order?: number; is_custom?: boolean; is_handled?: boolean; is_mandatory?: boolean; requires_reason?: boolean; assigned_agent_ids?: string[]; enables_voice_message?: boolean; voice_message_template?: string; voice_message_api_key?: string; voice_send_mode?: "manual" | "auto"; auto_send_start_hour?: number; auto_send_end_hour?: number }) =>
    z.object({
      status_key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "מפתח חייב להכיל אותיות אנגליות קטנות, ספרות וקו תחתון בלבד"),
      label: z.string().min(1).max(100),
      tone: z.string().min(1).max(40),
      sort_order: z.number().int().min(0).max(10000).optional(),
      is_custom: z.boolean().optional(),
      is_handled: z.boolean().optional(),
      is_mandatory: z.boolean().optional(),
      requires_reason: z.boolean().optional(),
      assigned_agent_ids: z.array(z.string().uuid()).max(50).optional(),
      enables_voice_message: z.boolean().optional(),
      voice_message_template: z.string().max(20).regex(/^\d*$/, "מספר ההודעה חייב להכיל ספרות בלבד").optional(),
      voice_message_api_key: z.string().max(500).optional(),
      voice_send_mode: z.enum(["manual", "auto"]).optional(),
      auto_send_start_hour: z.number().int().min(0).max(23).optional(),
      auto_send_end_hour: z.number().int().min(0).max(23).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {
      status_key: data.status_key,
      label: sanitizeText(data.label),
      tone: data.tone,
      is_custom: data.is_custom ?? false,
    };
    if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
    if (data.is_handled !== undefined) patch.is_handled = data.is_handled;
    if (data.is_mandatory !== undefined) patch.is_mandatory = data.is_mandatory;
    if (data.requires_reason !== undefined) patch.requires_reason = data.requires_reason;
    if (data.assigned_agent_ids !== undefined) patch.assigned_agent_ids = data.assigned_agent_ids;
    if (data.enables_voice_message !== undefined) patch.enables_voice_message = data.enables_voice_message;
    if (data.voice_message_template !== undefined) patch.voice_message_template = data.voice_message_template.trim();
    if (data.voice_message_api_key !== undefined) patch.voice_message_api_key = data.voice_message_api_key.trim();
    if (data.voice_send_mode !== undefined) patch.voice_send_mode = data.voice_send_mode;
    if (data.auto_send_start_hour !== undefined) patch.auto_send_start_hour = data.auto_send_start_hour;
    if (data.auto_send_end_hour !== undefined) patch.auto_send_end_hour = data.auto_send_end_hour;
    await upsertStatusSettingStable(supabaseAdmin, patch, context.userId);
    return { ok: true };
  });

export const reorderStatusSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order: string[] }) =>
    z.object({ order: z.array(z.string().min(1).max(60)).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await reorderStatusSettingsStable(supabaseAdmin, data.order, context.userId);
    return { ok: true };
  });

export const deleteStatusSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status_key: string }) =>
    z.object({ status_key: z.string().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await deleteStatusSettingStable(supabaseAdmin, data.status_key, context.userId);
    return { ok: true };
  });

// ============= Dynamic permissions =============

export const listPermissionSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ crmKey: z.string().min(1).max(60) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertPermission(context, "permissions_manage", data.crmKey);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PERMISSION_DEFINITIONS } = await import("@/lib/permissions.server");
    const [{ data: rolePermissions, error: rpErr }, { data: userPermissions, error: upErr }, { data: profiles }, { data: roles }, usersList] = await Promise.all([
      supabaseAdmin.from("role_permissions").select("role, permission, allowed, updated_at, updated_by").eq("crm_key", data.crmKey).order("permission", { ascending: true }),
      supabaseAdmin.from("user_permissions").select("user_id, permission, allowed, updated_at, updated_by").eq("crm_key", data.crmKey).order("permission", { ascending: true }),
      supabaseAdmin.from("profiles").select("id, display_name, created_at"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.auth.admin.listUsers(),
    ]);
    if (rpErr && !isSchemaCacheMissing(rpErr)) throw fromSupabase(rpErr);
    if (upErr && !isSchemaCacheMissing(upErr)) throw fromSupabase(upErr);

    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    const profileMap = new Map<string, any>();
    (profiles ?? []).forEach((p: any) => profileMap.set(p.id, p));
    const users = (usersList.data?.users ?? []).map((u: any) => {
      const p = profileMap.get(u.id);
      return {
        id: u.id,
        display_name: p?.display_name ?? (u.user_metadata?.display_name as string | undefined) ?? u.email?.split("@")[0] ?? "משתמש",
        email: u.email ?? "",
        roles: roleMap.get(u.id) ?? [],
      };
    }).sort((a: any, b: any) => String(a.display_name).localeCompare(String(b.display_name), "he"));

    return {
      roles: ROLES,
      permissions: PERMISSION_DEFINITIONS,
      rolePermissions: rpErr ? DEFAULT_ROLE_PERMISSION_ROWS : rolePermissions ?? [],
      userPermissions: upErr ? [] : userPermissions ?? [],
      users,
    };
  });

export const setRolePermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { crmKey: string; role: string; permission: string; allowed: boolean }) =>
    z.object({
      crmKey: z.string().min(1).max(60),
      role: z.enum(ROLES),
      permission: z.enum(PERMISSION_KEYS),
      allowed: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "permissions_manage", data.crmKey);
    if (data.role === "super_admin" && data.permission === "permissions_manage" && data.allowed === false) {
      throw new AppError("לא ניתן להסיר הרשאת ניהול הרשאות ממנהל ראשי", { code: "bad_request" });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("role_permissions").upsert({ crm_key: data.crmKey, role: data.role, permission: data.permission, allowed: data.allowed, updated_at: new Date().toISOString(), updated_by: context.userId }, { onConflict: "crm_key,role,permission" });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const setUserPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { crmKey: string; user_id: string; permission: string; allowed: boolean }) =>
    z.object({
      crmKey: z.string().min(1).max(60),
      user_id: z.string().uuid(),
      permission: z.enum(PERMISSION_KEYS),
      allowed: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "permissions_manage", data.crmKey);
    if (data.user_id === context.userId && data.permission === "permissions_manage" && data.allowed === false) {
      throw new AppError("לא ניתן להסיר מעצמך הרשאת ניהול הרשאות", { code: "bad_request" });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_permissions").upsert({ crm_key: data.crmKey, user_id: data.user_id, permission: data.permission, allowed: data.allowed, updated_at: new Date().toISOString(), updated_by: context.userId }, { onConflict: "crm_key,user_id,permission" });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const deleteUserPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { crmKey: string; user_id: string; permission: string }) =>
    z.object({ crmKey: z.string().min(1).max(60), user_id: z.string().uuid(), permission: z.enum(PERMISSION_KEYS) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "permissions_manage", data.crmKey);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_permissions").delete().eq("crm_key", data.crmKey).eq("user_id", data.user_id).eq("permission", data.permission);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

// ============= Series detection settings =============

const SERIES_KEY = "series_detection";
type SeriesMode = { strip: number; min: number };
const DEFAULT_SERIES: { modes: SeriesMode[] } = { modes: [{ strip: 2, min: 10 }, { strip: 3, min: 30 }] };

export const getSeriesDetection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", SERIES_KEY).maybeSingle();
    const val = (data?.value as any) ?? DEFAULT_SERIES;
    const modes: SeriesMode[] = Array.isArray(val.modes) ? val.modes : DEFAULT_SERIES.modes;
    return { modes };
  });

export const setSeriesDetection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { modes: SeriesMode[] }) =>
    z.object({
      modes: z.array(z.object({
        strip: z.number().int().min(1).max(10),
        min: z.number().int().min(2).max(1000),
      })).min(1).max(10),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "series_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: SERIES_KEY, value: { modes: data.modes }, updated_by: context.userId,
    });
    if (error) throw fromSupabase(error);
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
    await assertGlobalPermission(context, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: AUTO_SNOOZE_KEY,
      value: data,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

function computeSnoozeUntil(unit: string, date?: string|null): string {
  const now = new Date();
  if (unit === "day") now.setDate(now.getDate() + 1);
  else if (unit === "week") now.setDate(now.getDate() + 7);
  else if (unit === "month") now.setMonth(now.getMonth() + 1);
  else if (unit === "date") {
    if (!date) throw new AppError("יש לבחור תאריך", { code: "validation" });
    return new Date(date).toISOString();
  }
  return now.toISOString();
}

// ============= Backup email setting =============

const BACKUP_EMAIL_KEY = "backup_email";

// Stored as { emails: string[] }. Older rows may still have the legacy
// single-string { email } shape — read both, always write the new shape.
export const getBackupEmail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAnyPermission(context, ["backup_manage", "settings_manage"]);
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", BACKUP_EMAIL_KEY).maybeSingle();
    const v = (data?.value as { email?: string; emails?: string[] } | null) ?? null;
    const emails = Array.isArray(v?.emails) && v.emails.length
      ? v.emails
      : (v?.email ? [v.email] : []);
    return { emails };
  });

export const setBackupEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { emails: string[] }) =>
    z.object({ emails: z.array(z.string().email().max(200)).max(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "backup_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // De-dupe, case-insensitively, while preserving the order the admin typed them in.
    const seen = new Set<string>();
    const emails = data.emails.filter((e) => {
      const key = e.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: BACKUP_EMAIL_KEY,
      value: { emails },
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

// ============= Backup schedule (frequency + time of day) =============
// Consumed by the pg_cron heartbeat (every 15 min) via
// /api/public/hooks/scheduled-backup-check — see backups.server.ts
// shouldRunScheduledBackup() for the matching logic. Hour/day are in Asia/Jerusalem
// local time so admins don't have to think in UTC.

const BACKUP_SCHEDULE_KEY = "backup_schedule";

export type BackupSchedule = {
  frequency: "daily" | "weekly";
  hour: number; // 0-23, Asia/Jerusalem local time
  dayOfWeek: number; // 0 (Sunday) - 6 (Saturday), only used when frequency === "weekly"
};

const DEFAULT_BACKUP_SCHEDULE: BackupSchedule = { frequency: "daily", hour: 2, dayOfWeek: 4 };

export const getBackupSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAnyPermission(context, ["backup_manage", "settings_manage"]);
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", BACKUP_SCHEDULE_KEY).maybeSingle();
    const v = (data?.value as Partial<BackupSchedule> | null) ?? null;
    return {
      frequency: v?.frequency === "weekly" ? "weekly" : "daily",
      hour: typeof v?.hour === "number" && v.hour >= 0 && v.hour <= 23 ? v.hour : DEFAULT_BACKUP_SCHEDULE.hour,
      dayOfWeek: typeof v?.dayOfWeek === "number" && v.dayOfWeek >= 0 && v.dayOfWeek <= 6 ? v.dayOfWeek : DEFAULT_BACKUP_SCHEDULE.dayOfWeek,
    } as BackupSchedule;
  });

export const setBackupSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: BackupSchedule) =>
    z.object({
      frequency: z.enum(["daily", "weekly"]),
      hour: z.number().int().min(0).max(23),
      dayOfWeek: z.number().int().min(0).max(6),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "backup_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: BACKUP_SCHEDULE_KEY,
      value: data,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

// ============= Backup webhook config (used by the DB-side pg_cron =============
// job so scheduled backups fire regardless of which platform hosts the app —
// see supabase/migrations/*_scheduled_backups.sql). The secret entered here
// must match the BACKUP_WEBHOOK_SECRET env var configured on the server.

const BACKUP_WEBHOOK_URL_KEY = "backup_webhook_url";
const BACKUP_WEBHOOK_SECRET_KEY = "backup_webhook_secret";

export const getBackupWebhookConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAnyPermission(context, ["backup_manage", "settings_manage"]);
    const { data } = await context.supabase
      .from("app_settings").select("key, value").in("key", [BACKUP_WEBHOOK_URL_KEY, BACKUP_WEBHOOK_SECRET_KEY]);
    const url = ((data ?? []).find((r: any) => r.key === BACKUP_WEBHOOK_URL_KEY)?.value as { url?: string } | undefined)?.url ?? "";
    const hasSecret = !!((data ?? []).find((r: any) => r.key === BACKUP_WEBHOOK_SECRET_KEY)?.value as { secret?: string } | undefined)?.secret;
    return { url, hasSecret };
  });

export const setBackupWebhookConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string; secret?: string }) =>
    z.object({ url: z.string().max(300).refine((v) => v === "" || /^https?:\/\//.test(v), "כתובת חייבת להתחיל ב-http/https"), secret: z.string().max(300).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "backup_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { error: urlErr } = await supabaseAdmin.from("app_settings").upsert({
      key: BACKUP_WEBHOOK_URL_KEY,
      value: { url: data.url.replace(/\/$/, "") },
      updated_at: now,
      updated_by: context.userId,
    });
    if (urlErr) throw fromSupabase(urlErr);
    // Only overwrite the stored secret if a new one was actually typed —
    // an empty/omitted value means "keep the existing secret".
    if (data.secret) {
      const { error: secretErr } = await supabaseAdmin.from("app_settings").upsert({
        key: BACKUP_WEBHOOK_SECRET_KEY,
        value: { secret: data.secret },
        updated_at: now,
        updated_by: context.userId,
      });
      if (secretErr) throw fromSupabase(secretErr);
    }
    return { ok: true };
  });

// ============= Stale-warning hours (for conditional card coloring) =============

const STALE_HOURS_KEY = "stale_warning_hours";

export const getStaleWarningHours = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", STALE_HOURS_KEY).maybeSingle();
    const v = (data?.value as { hours?: number } | null) ?? null;
    return { hours: typeof v?.hours === "number" ? v.hours : 24 };
  });

export const setStaleWarningHours = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { hours: number }) =>
    z.object({ hours: z.number().int().min(0).max(8760) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalPermission(context, "settings_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: STALE_HOURS_KEY,
      value: { hours: data.hours },
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

// ============= Notification center =============
// Returns recent events relevant to the current user:
//  - transfers to/from me
//  - notes written by others on systems I'm assigned to
//  - status / agent changes by others on my systems
// "Unread" state is tracked client-side via localStorage (last-read timestamp).

// The bell only surfaces two kinds of notifications, on purpose: places the
// user was explicitly @-mentioned in a note, and new inbound emails on
// systems assigned to them. Transfers, plain notes, and status/agent-change
// activity are intentionally excluded — those are visible on the system
// card itself and don't need to interrupt via the bell.
export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = context.userId;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: mySystems }, { data: allProfiles }] = await Promise.all([
      context.supabase.from("systems").select("id, system_code, name").eq("assigned_agent_id", me),
      context.supabase.from("profiles").select("id, display_name"),
    ]);
    const myIds = (mySystems ?? []).map((s: any) => s.id);
    const sysMap = new Map<string, { code: string; name: string }>(
      (mySystems ?? []).map((s: any) => [s.id, { code: s.system_code, name: s.name }]),
    );
    const pmap = new Map((allProfiles ?? []).map((p: any) => [p.id, p.display_name]));
    const myName = String(pmap.get(me) ?? "").trim();
    const isMentioned = (body: string) => {
      const text = String(body ?? "");
      if (text.includes("@כולם")) return true;
      const name = myName.trim();
      if (!name) return false;
      // Robust match: ignore case and tolerate the mention being followed by
      // whitespace/punctuation or end-of-string (not just an exact substring).
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`@${escaped}(?:\\s|$|[,.:;!?])`, "iu");
      return re.test(text);
    };

    let inboundEmails: any[] = [];
    if (myIds.length > 0) {
      const { data } = await context.supabase.from("email_messages" as any)
        .select("id, system_id, from_address, subject, body, created_at")
        .in("system_id", myIds).eq("direction", "inbound").gte("created_at", since)
        .order("created_at", { ascending: false }).limit(50);
      inboundEmails = (data as any[]) ?? [];
    }

    const { data: mentionRows } = await context.supabase
      .from("system_notes")
      .select("id, system_id, body, author_id, created_at")
      .neq("author_id", me)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    const mentionNotes = (mentionRows ?? []).filter((n: any) => isMentioned(n.body));

    const extraIds = Array.from(new Set(
      mentionNotes.map((n: any) => n.system_id).filter((id: string) => id && !sysMap.has(id)),
    ));
    if (extraIds.length) {
      const { data: extra } = await context.supabase
        .from("systems").select("id, system_code, name").in("id", extraIds);
      for (const s of (extra ?? []) as any[]) sysMap.set(s.id, { code: s.system_code, name: s.name });
    }

    const items: any[] = [];
    for (const n of mentionNotes) {
      const sys = sysMap.get(n.system_id);
      items.push({
        id: `m:${n.id}`, kind: "mention", system_id: n.system_id,
        system_code: sys?.code, system_name: sys?.name, created_at: n.created_at,
        title: String(n.body ?? "").includes("@כולם") ? "תיוג לכל הנציגים" : "תויגת בהערה",
        detail: pmap.get(n.author_id) ?? "לא ידוע",
        reason: (n.body ?? "").slice(0, 120),
      });
    }
    for (const e of inboundEmails) {
      const sys = sysMap.get(e.system_id);
      items.push({
        id: `e:${e.id}`, kind: "email", system_id: e.system_id,
        system_code: sys?.code, system_name: sys?.name, created_at: e.created_at,
        title: "מייל חדש",
        detail: e.from_address ?? "פונה",
        reason: (e.subject ? `${e.subject} — ` : "") + String(e.body ?? "").slice(0, 100),
      });
    }
    // ===== Records from every other CRM (shared bell) =====
    const { data: myRecords } = await context.supabase
      .from("crm_records").select("id, crm_key, record_code, name").eq("assigned_agent_id", me);
    const recMap = new Map<string, { crm: string; code: string; name: string }>(
      ((myRecords ?? []) as any[]).map((r) => [r.id, { crm: r.crm_key, code: r.record_code, name: r.name }]),
    );

    const { data: crmNoteRows } = await context.supabase
      .from("crm_record_notes")
      .select("id, record_id, crm_key, body, author_id, created_at")
      .neq("author_id", me)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    const crmMentions = ((crmNoteRows ?? []) as any[]).filter((n) => isMentioned(n.body));

    const extraRecIds = Array.from(new Set(
      crmMentions.map((n: any) => n.record_id).filter((id: string) => id && !recMap.has(id)),
    ));
    if (extraRecIds.length) {
      const { data: extra } = await context.supabase
        .from("crm_records").select("id, crm_key, record_code, name").in("id", extraRecIds);
      for (const r of (extra ?? []) as any[]) recMap.set(r.id, { crm: r.crm_key, code: r.record_code, name: r.name });
    }

    for (const n of crmMentions) {
      const rec = recMap.get(n.record_id);
      items.push({
        id: `cm:${n.id}`, kind: "mention", system_id: n.record_id, crm_key: rec?.crm ?? n.crm_key,
        system_code: rec?.code, system_name: rec?.name, created_at: n.created_at,
        title: String(n.body ?? "").includes("@כולם") ? "תיוג לכל הנציגים" : "תויגת בהערה",
        detail: pmap.get(n.author_id) ?? "לא ידוע",
        reason: (n.body ?? "").slice(0, 120),
      });
    }

    const myRecIds = Array.from(recMap.keys());
    if (myRecIds.length) {
      const { data: crmEmails } = await context.supabase.from("email_messages" as any)
        .select("id, crm_record_id, from_address, subject, body, created_at")
        .in("crm_record_id", myRecIds).eq("direction", "inbound").gte("created_at", since)
        .order("created_at", { ascending: false }).limit(50);
      for (const e of ((crmEmails as any[]) ?? [])) {
        const rec = recMap.get(e.crm_record_id);
        items.push({
          id: `ce:${e.id}`, kind: "email", system_id: e.crm_record_id, crm_key: rec?.crm,
          system_code: rec?.code, system_name: rec?.name, created_at: e.created_at,
          title: "מייל חדש", detail: e.from_address ?? "פונה",
          reason: (e.subject ? `${e.subject} — ` : "") + String(e.body ?? "").slice(0, 100),
        });
      }
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return items.slice(0, 50);
  });

