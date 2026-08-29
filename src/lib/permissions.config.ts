// Static permission model — the single source of truth for permission keys,
// labels and per-role defaults.
//
// This file is intentionally FREE of any I/O, Supabase import or server-only
// dependency, so both `permissions.server.ts` and client-reachable modules
// (`admin.functions.ts`, UI panels) can derive from it without dragging the
// service-role client into a browser bundle.

export const ROLE_HIERARCHY = ["super_admin", "admin", "agent", "viewer"] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "מנהל ראשי",
  admin: "מנהל",
  agent: "נציג",
  viewer: "צופה",
};

export const PERMISSION_DEFINITIONS = [
  { key: "systems_read", label: "צפייה במערכות", description: "כניסה לדשבורד וצפייה בכרטיסי מערכת" },
  { key: "systems_write", label: "עריכת מערכות", description: "יצירה ועריכה כללית של מערכות" },
  { key: "systems_delete", label: "מחיקת מערכות", description: "מחיקת מערכת ראשית או תת־מערכת" },
  { key: "system_name_edit", label: "עריכת שם מערכת", description: "שינוי שם של מערכת קיימת" },
  { key: "system_code_edit", label: "עריכת מספר מערכת", description: "שינוי מזהה/מספר לחיוג של מערכת קיימת" },
  { key: "status_change", label: "שינוי סטטוס", description: "החלפת סטטוס למערכת" },
  { key: "agent_transfer", label: "העברת נציג", description: "שיוך מערכת לנציג אחר" },
  { key: "notes_write", label: "הוספת הערות", description: "כתיבת הערות בכרטיס מערכת" },
  { key: "emails_send", label: "שליחת מיילים", description: "שליחת מייל חדש או תגובה בתוך שרשור מתוך כרטיס מערכת" },
  { key: "emails_edit", label: "עריכת מיילים", description: "עריכת תוכן או נושא של הודעת מייל שנשמרה במערכת" },
  { key: "emails_delete", label: "מחיקת מיילים", description: "מחיקת הודעה בודדת או שרשור שלם מתיבת הדואר" },
  { key: "files_manage", label: "ניהול קבצים", description: "העלאה ומחיקה של קבצים מצורפים" },
  { key: "import_export", label: "ייבוא / ייצוא", description: "ייבוא מאקסל וייצוא נתונים" },
  { key: "series_manage", label: "השלמת סדרות", description: "סריקה ויצירה מרוכזת של מספרים חסרים" },
  { key: "backup_manage", label: "גיבויים", description: "יצירה, הורדה, שליחה ושחזור לפי רמת ההרשאה" },
  { key: "audit_view", label: "יומן בקרה", description: "צפייה ביומן הפעילות והבקרה" },
  { key: "settings_manage", label: "הגדרות מערכת", description: "סטטוסים, שיוכים אוטומטיים והגדרות כלליות" },
  { key: "users_manage", label: "ניהול משתמשים", description: "יצירה, מחיקה ועדכון משתמשים" },
  { key: "permissions_manage", label: "ניהול הרשאות", description: "שינוי הרשאות לפי תפקיד ולפי משתמש" },
  { key: "mailbox_view", label: "צפייה בתיבת הדואר", description: "כניסה ללשונית המיילים וצפייה בשרשורי הדואר" },
  { key: "history_edit", label: "עריכת הערות ופעילות", description: "עריכה ומחיקה של הערות ושורות ביומן הפעילות של כל המשתמשים" },
  { key: "requests_view", label: "צפייה בבקשות", description: "צפייה בתור בקשות הפתיחה/סגירה מהמייל ובהיסטוריית הבקשות בכרטיס מערכת" },
  { key: "requests_decide", label: "טיפול בבקשות", description: "קבלת החלטה על בקשה: החלת סטטוס, השארה ללא שינוי או התעלמות (מחייב גם צפייה בבקשות)" },
  { key: "requests_manage", label: "ניהול אוטומציית בקשות", description: "שינוי מצב האוטומציה, כללי הבקשות וסטטוסי ברירת המחדל" },
] as const;

export type PermissionKey = (typeof PERMISSION_DEFINITIONS)[number]["key"];

// Tuple-typed so it can be handed straight to `z.enum(...)`.
export const PERMISSION_KEYS = PERMISSION_DEFINITIONS.map((p) => p.key) as unknown as [PermissionKey, ...PermissionKey[]];

export const PERMISSION_LABEL = Object.fromEntries(
  PERMISSION_DEFINITIONS.map((p) => [p.key, p.label]),
) as Record<PermissionKey, string>;

/**
 * Permissions that are implied by another one. `requests_decide` without
 * `requests_view` is meaningless (and dangerous), so deciding always requires
 * viewing — enforced on the server, not only in the UI.
 */
export const PERMISSION_PREREQUISITES: Partial<Record<PermissionKey, PermissionKey[]>> = {
  requests_decide: ["requests_view"],
  requests_manage: ["requests_view"],
};

/** Allowed-by-default permission keys per role. Anything absent defaults to false. */
const DEFAULT_ALLOWED: Record<Role, PermissionKey[]> = {
  viewer: ["systems_read"],
  agent: [
    "systems_read", "systems_write", "status_change", "agent_transfer",
    "notes_write", "emails_send", "files_manage", "mailbox_view",
  ],
  admin: [
    "systems_read", "systems_write", "system_name_edit", "status_change", "agent_transfer",
    "notes_write", "emails_send", "emails_edit", "emails_delete", "files_manage",
    "import_export", "series_manage", "backup_manage", "settings_manage", "mailbox_view",
    "history_edit",
  ],
  // Requests automation is deliberately super-admin-only until it is trusted
  // in production; grant it explicitly in ניהול → הרשאות when needed.
  super_admin: [...PERMISSION_KEYS],
};

export const DEFAULT_ROLE_PERMISSIONS = Object.fromEntries(
  ROLE_HIERARCHY.map((role) => [
    role,
    Object.fromEntries(PERMISSION_KEYS.map((key) => [key, DEFAULT_ALLOWED[role].includes(key)])),
  ]),
) as Record<Role, Record<PermissionKey, boolean>>;

export function isPermissionKey(permission: unknown): permission is PermissionKey {
  return typeof permission === "string" && (PERMISSION_KEYS as string[]).includes(permission);
}

export function isRole(role: unknown): role is Role {
  return typeof role === "string" && (ROLE_HIERARCHY as readonly string[]).includes(role);
}

export function defaultPermissionForRoles(roles: Role[], permission: PermissionKey): boolean {
  return roles.some((role) => DEFAULT_ROLE_PERMISSIONS[role]?.[permission] === true);
}

/** Flat default matrix, used to seed `role_permissions` and as a fallback. */
export function defaultRolePermissionRows(): Array<{ role: Role; permission: PermissionKey; allowed: boolean }> {
  return ROLE_HIERARCHY.flatMap((role) =>
    PERMISSION_KEYS.map((permission) => ({
      role,
      permission,
      allowed: DEFAULT_ROLE_PERMISSIONS[role][permission],
    })),
  );
}
