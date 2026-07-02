import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AppError, fromSupabase } from "@/lib/errors";
import { sanitizeText } from "@/lib/sanitize";

// All authorization goes through `assertRole` / `hasRole` from
// @/lib/permissions.server — no other mechanism is used in this file.
async function assertAdmin(context: { userId: string }) {
  const { assertRole } = await import("@/lib/permissions.server");
  await assertRole(context.userId, "admin");
}

async function assertSuperAdmin(context: { userId: string }) {
  const { assertRole } = await import("@/lib/permissions.server");
  await assertRole(context.userId, "super_admin");
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
    await assertSuperAdmin(context);
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
    await assertSuperAdmin(context);
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
    await assertSuperAdmin(context);
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
    await assertSuperAdmin(context);
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
    await assertSuperAdmin(context);
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
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data, error }, { data: prof }] = await Promise.all([
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
    ]);
    if (error) throw fromSupabase(error);
    const roles = (data ?? []).map((r: any) => r.role).filter((r: any) =>
      r === "super_admin" || r === "admin" || r === "agent" || r === "viewer",
    );
    const isSuperAdmin = roles.includes("super_admin");
    const isAdmin = isSuperAdmin || roles.includes("admin");
    const isAgent = isAdmin || roles.includes("agent");
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
      displayName: (prof as any)?.display_name ?? null,
    };
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
      .select("status_key, label, tone, sort_order, is_custom, is_handled, is_mandatory, assigned_agent_ids")
      .order("sort_order", { ascending: true });
    if (error) throw fromSupabase(error);
    return data ?? [];
  });

export const upsertStatusSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status_key: string; label: string; tone: string; sort_order?: number; is_custom?: boolean; is_handled?: boolean; is_mandatory?: boolean; assigned_agent_ids?: string[] }) =>
    z.object({
      status_key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "מפתח חייב להכיל אותיות אנגליות קטנות, ספרות וקו תחתון בלבד"),
      label: z.string().min(1).max(100),
      tone: z.string().min(1).max(40),
      sort_order: z.number().int().min(0).max(10000).optional(),
      is_custom: z.boolean().optional(),
      is_handled: z.boolean().optional(),
      is_mandatory: z.boolean().optional(),
      assigned_agent_ids: z.array(z.string().uuid()).max(50).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {
      status_key: data.status_key,
      label: sanitizeText(data.label),
      tone: data.tone,
      sort_order: data.sort_order ?? 0,
      is_custom: data.is_custom ?? false,
    };
    if (data.is_handled !== undefined) patch.is_handled = data.is_handled;
    if (data.is_mandatory !== undefined) patch.is_mandatory = data.is_mandatory;
    if (data.assigned_agent_ids !== undefined) patch.assigned_agent_ids = data.assigned_agent_ids;
    const { error } = await supabaseAdmin.from("status_settings").upsert(patch);
    if (error) throw fromSupabase(error);
    return { ok: true };
  });

export const reorderStatusSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order: string[] }) =>
    z.object({ order: z.array(z.string().min(1).max(60)).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Renumber sequentially 1..N
    await Promise.all(
      data.order.map((key, idx) =>
        supabaseAdmin.from("status_settings").update({ sort_order: idx + 1 }).eq("status_key", key),
      ),
    );
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
    const { error } = await supabaseAdmin.from("status_settings").delete().eq("status_key", data.status_key);
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
    await assertAdmin(context);
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
    await assertAdmin(context);
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

export const getBackupEmail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", BACKUP_EMAIL_KEY).maybeSingle();
    const v = (data?.value as { email?: string } | null) ?? null;
    return { email: v?.email ?? "" };
  });

export const setBackupEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string }) =>
    z.object({ email: z.string().email().max(200).or(z.literal("")) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: BACKUP_EMAIL_KEY,
      value: { email: data.email },
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw fromSupabase(error);
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
    await assertAdmin(context);
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

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = context.userId;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: mySystems } = await context.supabase
      .from("systems").select("id, system_code, name").eq("assigned_agent_id", me);
    const myIds = (mySystems ?? []).map((s: any) => s.id);
    const sysMap = new Map<string, { code: string; name: string }>(
      (mySystems ?? []).map((s: any) => [s.id, { code: s.system_code, name: s.name }]),
    );

    const { data: transfers } = await context.supabase
      .from("system_transfers")
      .select("id, system_id, from_agent_id, to_agent_id, transferred_by, reason, created_at")
      .or(`to_agent_id.eq.${me},from_agent_id.eq.${me}`)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    let notes: any[] = [];
    let activity: any[] = [];
    if (myIds.length > 0) {
      const [notesRes, actRes] = await Promise.all([
        context.supabase.from("system_notes")
          .select("id, system_id, body, author_id, created_at")
          .in("system_id", myIds).neq("author_id", me).gte("created_at", since)
          .order("created_at", { ascending: false }).limit(50),
        context.supabase.from("system_activity_log")
          .select("id, system_id, actor_id, actor_display_name, action, field, old_value, new_value, created_at")
          .in("system_id", myIds).neq("actor_id", me)
          .in("field", ["status", "assigned_agent_id"])
          .gte("created_at", since)
          .order("created_at", { ascending: false }).limit(50),
      ]);
      notes = notesRes.data ?? [];
      activity = actRes.data ?? [];
    }

    const extraIds = Array.from(new Set(
      (transfers ?? []).map((t: any) => t.system_id).filter((id: string) => id && !sysMap.has(id)),
    ));
    if (extraIds.length) {
      const { data: extra } = await context.supabase
        .from("systems").select("id, system_code, name").in("id", extraIds);
      for (const s of (extra ?? []) as any[]) sysMap.set(s.id, { code: s.system_code, name: s.name });
    }
    const { data: profiles } = await context.supabase.from("profiles").select("id, display_name");
    const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));

    const items: any[] = [];
    for (const t of (transfers ?? []) as any[]) {
      const sys = sysMap.get(t.system_id);
      const toMe = t.to_agent_id === me;
      const other = toMe ? t.from_agent_id : t.to_agent_id;
      items.push({
        id: `t:${t.id}`, kind: "transfer", system_id: t.system_id,
        system_code: sys?.code, system_name: sys?.name, created_at: t.created_at,
        title: toMe ? "הועברה אליך מערכת" : "הועברה ממך מערכת",
        detail: other ? (pmap.get(other) ?? "לא ידוע") : "לא משויך",
        reason: t.reason ?? null,
      });
    }
    for (const n of notes) {
      const sys = sysMap.get(n.system_id);
      items.push({
        id: `n:${n.id}`, kind: "note", system_id: n.system_id,
        system_code: sys?.code, system_name: sys?.name, created_at: n.created_at,
        title: "הערה חדשה",
        detail: pmap.get(n.author_id) ?? "לא ידוע",
        reason: (n.body ?? "").slice(0, 120),
      });
    }
    for (const a of activity) {
      const sys = sysMap.get(a.system_id);
      items.push({
        id: `a:${a.id}`, kind: "activity", system_id: a.system_id,
        system_code: sys?.code, system_name: sys?.name, created_at: a.created_at,
        title: a.field === "status" ? "שינוי סטטוס" : "שינוי נציג",
        detail: a.actor_display_name ?? (a.actor_id ? pmap.get(a.actor_id) ?? "לא ידוע" : "מערכת"),
        reason: `${a.old_value ?? "—"} ← ${a.new_value ?? "—"}`,
      });
    }
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return items.slice(0, 50);
  });



