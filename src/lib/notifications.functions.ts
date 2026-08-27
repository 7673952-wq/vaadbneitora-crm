import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  type NotificationEventKey,
} from "@/lib/notification-events";

type AppRole = "admin" | "agent" | "super_admin" | "viewer";
const ROLES: AppRole[] = ["admin", "agent", "super_admin", "viewer"];

async function assertNotificationsAdmin(context: { userId: string }) {
  const { assertAnyPermission } = await import("@/lib/permissions.server");
  await assertAnyPermission(context.userId, ["users_manage", "permissions_manage", "settings_manage"]);
}

async function fetchMyRoles(supabase: any, userId: string): Promise<AppRole[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return ((data ?? []) as { role: AppRole }[]).map((r) => r.role);
}

function defaultForEvent(key: string): boolean {
  const ev = NOTIFICATION_EVENTS.find((e) => e.key === key);
  return ev ? ev.defaultEnabled : true;
}

/** The full events catalog. Client-safe reference for building UIs. */
export const listNotificationEvents = createServerFn({ method: "GET" })
  .handler(async () => NOTIFICATION_EVENTS);

/** Current user's effective on/off per event (role defaults + own overrides). */
export const getMyNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .handler(async ({ context }) => {
    const roles = await fetchMyRoles(context.supabase, context.userId);
    const [{ data: defaults }, { data: overrides }] = await Promise.all([
      roles.length
        ? context.supabase.from("notification_role_defaults").select("event_key, role, enabled").in("role", roles as any)
        : Promise.resolve({ data: [] as any[] }),
      context.supabase.from("notification_user_overrides").select("event_key, enabled").eq("user_id", context.userId),
    ]);
    const effective: Record<string, boolean> = {};
    for (const ev of NOTIFICATION_EVENTS) effective[ev.key] = ev.defaultEnabled;
    // Any role's `true` wins over any other role's `false` — least restrictive.
    for (const row of (defaults ?? []) as { event_key: string; enabled: boolean }[]) {
      if (row.enabled) effective[row.event_key] = true;
      else if (effective[row.event_key] === undefined) effective[row.event_key] = false;
    }
    // Recompute cleanly: start from defaultEnabled, mark ON if any role default = true; otherwise = false if any role explicitly false.
    for (const ev of NOTIFICATION_EVENTS) {
      const rowsForEvent = (defaults ?? []).filter((d: any) => d.event_key === ev.key);
      if (rowsForEvent.length > 0) {
        effective[ev.key] = rowsForEvent.some((d: any) => d.enabled === true);
      } else {
        effective[ev.key] = ev.defaultEnabled;
      }
    }
    // User overrides trump role defaults.
    for (const row of (overrides ?? []) as { event_key: string; enabled: boolean }[]) {
      effective[row.event_key] = row.enabled;
    }
    return effective;
  });

/**
 * Event keys are either a plain catalog key (global / "ימות המשיח" scope) or a
 * per-CRM scoped key: `crm:<crmKey>:<event>`.
 */
const scopedEventKey = z
  .string()
  .max(120)
  .refine((v) => {
    const m = /^crm:[a-z0-9_-]+:(.+)$/.exec(v);
    const base = m ? m[1] : v;
    return (NOTIFICATION_EVENT_KEYS as string[]).includes(base);
  }, "אירוע לא מוכר");

/** Admin: full grid role×event of enabled flags, optionally scoped to a CRM. */
export const listRoleNotificationDefaults = createServerFn({ method: "GET" })
  .middleware([requireAuthMfa])
  .inputValidator((input: unknown) =>
    z.object({ crmKey: z.string().max(60).nullable().optional() }).default({}).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertNotificationsAdmin(context);
    const crmKey = data?.crmKey && data.crmKey !== "yemot" ? data.crmKey : null;
    const prefix = crmKey ? `crm:${crmKey}:` : "";
    const { data: rows } = await context.supabase
      .from("notification_role_defaults")
      .select("event_key, role, enabled");
    const map = new Map<string, boolean>();
    for (const r of ((rows ?? []) as { event_key: string; role: AppRole; enabled: boolean }[])) {
      map.set(`${r.role}::${r.event_key}`, r.enabled);
    }
    const grid: { role: AppRole; event_key: string; enabled: boolean }[] = [];
    for (const role of ROLES) {
      for (const ev of NOTIFICATION_EVENTS) {
        const scoped = `${prefix}${ev.key}`;
        const key = `${role}::${scoped}`;
        grid.push({ role, event_key: scoped, enabled: map.has(key) ? map.get(key)! : ev.defaultEnabled });
      }
    }
    return {
      grid,
      events: NOTIFICATION_EVENTS.map((e) => ({ ...e, key: `${prefix}${e.key}` })),
      roles: ROLES,
    };
  });

/** Admin: set a single (role, event) default. */
export const updateRoleNotificationDefault = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { role: AppRole; event_key: string; enabled: boolean }) =>
    z.object({
      role: z.enum(["admin", "agent", "super_admin", "viewer"]),
      event_key: scopedEventKey,
      enabled: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertNotificationsAdmin(context);
    const { error } = await context.supabase
      .from("notification_role_defaults")
      .upsert(
        { role: data.role, event_key: data.event_key, enabled: data.enabled, updated_by: context.userId },
        { onConflict: "role,event_key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Current user: set an override for themselves. Passing enabled=null clears the override. */
export const setMyNotificationOverride = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { event_key: string; enabled: boolean | null }) =>
    z.object({
      event_key: z.enum(NOTIFICATION_EVENT_KEYS as [NotificationEventKey, ...NotificationEventKey[]]),
      enabled: z.boolean().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.enabled === null) {
      const { error } = await context.supabase
        .from("notification_user_overrides")
        .delete()
        .eq("user_id", context.userId)
        .eq("event_key", data.event_key);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await context.supabase
      .from("notification_user_overrides")
      .upsert(
        { user_id: context.userId, event_key: data.event_key, enabled: data.enabled },
        { onConflict: "user_id,event_key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export { defaultForEvent };
