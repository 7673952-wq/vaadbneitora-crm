// Single source of truth for what a backup contains.
// Backup, restore, the restore input validator and the UI all read this list,
// so adding a table here automatically covers every side of the pipeline.

export const BACKUP_TABLES = [
  "systems", "system_notes", "system_activity_log", "system_transfers", "system_files",
  "profiles", "user_roles", "role_permissions", "user_permissions",
  "status_settings", "app_settings", "voice_message_log",
  "email_messages", "email_threads", "email_templates",
  // Multi-CRM data — the general backup covers every CRM, not just Yemot.
  "crms", "crm_field_defs", "crm_user_roles", "crm_settings",
  "crm_records", "crm_record_notes", "crm_record_activity",
  "kosher_instructions", "notification_role_defaults", "notification_user_overrides",
  "dashboard_saved_views",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

// Insertion order for restore: parents before children so foreign keys resolve.
export const RESTORE_ORDER: readonly string[] = [
  "profiles", "user_roles", "role_permissions", "user_permissions",
  "status_settings", "app_settings", "crms", "crm_field_defs", "crm_user_roles", "crm_settings",
  "systems", "system_files", "system_notes", "system_transfers", "system_activity_log",
  "crm_records", "crm_record_notes", "crm_record_activity",
  "email_threads", "email_messages", "email_templates",
  "voice_message_log", "kosher_instructions",
  "notification_role_defaults", "notification_user_overrides",
  "dashboard_saved_views",
];

// Storage buckets whose actual files (not just their DB rows) are copied into
// every backup, under `storage/<bucket>/<path>`.
export const BACKUP_BUCKETS = ["system-files", "system-audio"] as const;
