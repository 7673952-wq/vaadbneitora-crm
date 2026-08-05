/** Shared (client-safe) mailbox preference types + defaults. */
export type MailboxPrefs = {
  defaultCleanupLevel: "none" | "light" | "standard" | "strict";
  defaultUseGeneralName: boolean;
  refreshSeconds: number;
  defaultFilter: "all" | "unread" | "inbox" | "sent";
  allowPersonalSignature: boolean;
};

export const MAILBOX_PREFS_DEFAULTS: MailboxPrefs = {
  defaultCleanupLevel: "standard",
  defaultUseGeneralName: false,
  refreshSeconds: 60,
  defaultFilter: "all",
  allowPersonalSignature: true,
};

export function parseMailboxPrefs(value: unknown): MailboxPrefs {
  const v = (value ?? {}) as Partial<MailboxPrefs>;
  return { ...MAILBOX_PREFS_DEFAULTS, ...v };
}
