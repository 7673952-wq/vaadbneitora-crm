/** Shared (client-safe) mailbox preference types + defaults. */
/** Gmail-style folders shown in the mailbox rail. */
export const MAIL_FOLDERS = ["inbox", "unread", "starred", "sent", "archive", "spam", "trash", "all"] as const;
export type MailFolder = (typeof MAIL_FOLDERS)[number];

export type MailboxPrefs = {
  defaultCleanupLevel: "none" | "light" | "standard" | "strict";
  defaultUseGeneralName: boolean;
  refreshSeconds: number;
  defaultFilter: MailFolder;
  allowPersonalSignature: boolean;
  /** Gmail label applied to sent mail + its thread (empty = default inbox behaviour). */
  gmailLabel: string;
  /** Remove the thread from the Inbox once the label is applied. */
  gmailArchive: boolean;
};

export const MAILBOX_PREFS_DEFAULTS: MailboxPrefs = {
  defaultCleanupLevel: "standard",
  defaultUseGeneralName: false,
  refreshSeconds: 60,
  defaultFilter: "inbox",
  allowPersonalSignature: true,
  gmailLabel: "",
  gmailArchive: false,
};

export function parseMailboxPrefs(value: unknown): MailboxPrefs {
  const v = (value ?? {}) as Partial<MailboxPrefs>;
  return { ...MAILBOX_PREFS_DEFAULTS, ...v };
}
