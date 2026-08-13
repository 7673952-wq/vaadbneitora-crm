import { z } from "zod";

// Single place that describes every server-side environment variable the app
// reads. Previously these were scattered across handlers, so a missing value
// only surfaced deep inside a request (or silently, as "skipped"). Use
// checkServerEnv() from a health/diagnostics path to see the whole picture at
// once, and requireEnv() where a value is mandatory for the operation.

const schema = z.object({
  // Required for anything that touches the database from the server.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  // Required for scheduled backups (pg_cron heartbeat authentication).
  BACKUP_WEBHOOK_SECRET: z.string().min(8).optional(),
  CRON_SECRET: z.string().min(8).optional(),
  // Optional integrations — features degrade gracefully when absent.
  EMAIL_RELAY_SECRET: z.string().min(8).optional(),
  RESEND_API_KEY: z.string().min(8).optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  WEEKLY_REPORT_EMAIL: z.string().optional(),
  WEEKLY_CRM_REPORT_TOKEN: z.string().min(8).optional(),
  YEMOT_API_KEY: z.string().min(4).optional(),
});

export type ServerEnvName = keyof z.infer<typeof schema>;

// Features that stop working when a variable is absent, for diagnostics.
export const ENV_FEATURES: Record<string, { vars: ServerEnvName[]; label: string }> = {
  database: { vars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], label: "בסיס נתונים" },
  scheduledBackups: { vars: ["BACKUP_WEBHOOK_SECRET"], label: "גיבוי אוטומטי מתוזמן" },
  emailRelay: { vars: ["EMAIL_RELAY_SECRET"], label: "ממסר מיילים (Gmail)" },
  transactionalEmail: { vars: ["RESEND_API_KEY"], label: "שליחת מייל דרך Resend" },
  crmReportExport: { vars: ["WEEKLY_CRM_REPORT_TOKEN"], label: "ייצוא דוח CRM שבועי" },
  voiceMessages: { vars: ["YEMOT_API_KEY"], label: "הודעות קוליות (ימות המשיח)" },
};

export function checkServerEnv() {
  const parsed = schema.safeParse(process.env);
  const missingRequired = parsed.success
    ? []
    : parsed.error.issues
        .filter((i) => i.code === "invalid_type" || i.message.includes("Required"))
        .map((i) => String(i.path[0]));
  const features = Object.fromEntries(
    Object.entries(ENV_FEATURES).map(([key, f]) => [
      key,
      { label: f.label, ready: f.vars.every((v) => !!process.env[v]) },
    ]),
  );
  return { ok: missingRequired.length === 0, missingRequired, features };
}

export function requireEnv(name: ServerEnvName): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה בשרת: ${name}`);
  return value;
}
