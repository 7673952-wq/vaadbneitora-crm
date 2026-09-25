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
  // Request automation + delivery/audit trails. These are durable business and
  // audit data: losing them loses the email-request history, who was mentioned,
  // what was delivered and the login audit trail.
  "system_request_rules", "system_requests",
  "note_mentions", "mention_email_deliveries", "email_deliveries", "voice_deliveries",
  "login_events", "mail_thread_state", "user_security",
] as const;

/**
 * Deliberately NOT backed up: transient session/anti-abuse state that is
 * meaningless once restored (and in some cases actively harmful to restore) —
 * `api_rate_limits`, `login_otp_challenges`, `mfa_grants`,
 * `mfa_passed_sessions`, `mfa_trusted_devices`. A backup therefore covers all
 * durable data, not literally every table.
 */
export const TRANSIENT_TABLES = [
  "api_rate_limits", "login_otp_challenges", "mfa_grants",
  "mfa_passed_sessions", "mfa_trusted_devices",
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
  "system_request_rules", "system_requests",
  "note_mentions", "mention_email_deliveries", "email_deliveries", "voice_deliveries",
  "login_events", "mail_thread_state", "user_security",
];

// Storage buckets whose actual files (not just their DB rows) are copied into
// every backup, under `storage/<bucket>/<path>`.
export const BACKUP_BUCKETS = ["system-files", "system-audio"] as const;
