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

/**
 * A conversation lives in exactly one place: moving it to archive, spam or
 * trash clears the others. Starring is orthogonal and survives a move.
 */
export function applyThreadFiling(
  current: { starred: boolean; archived: boolean; spam: boolean; trashed: boolean },
  change: Partial<{ starred: boolean; archived: boolean; spam: boolean; trashed: boolean }>,
) {
  const next = { ...current };
  if (change.starred !== undefined) next.starred = change.starred;
  if (change.archived !== undefined) { next.archived = change.archived; if (change.archived) { next.spam = false; next.trashed = false; } }
  if (change.spam !== undefined) { next.spam = change.spam; if (change.spam) { next.archived = false; next.trashed = false; } }
  if (change.trashed !== undefined) { next.trashed = change.trashed; if (change.trashed) { next.archived = false; next.spam = false; } }
  return next;
}

/** Does a conversation belong in the given Gmail-style folder? */
export function threadInFolder(
  t: { unread: number; hasInbound: boolean; hasOutbound: boolean; starred: boolean; archived: boolean; spam: boolean; trashed: boolean },
  folder: MailFolder,
) {
  const filed = t.archived || t.spam || t.trashed;
  switch (folder) {
    case "inbox": return t.hasInbound && !filed;
    case "unread": return t.unread > 0 && !filed;
    case "starred": return t.starred && !t.trashed;
    case "sent": return t.hasOutbound && !filed;
    case "archive": return t.archived && !t.trashed && !t.spam;
    case "spam": return t.spam && !t.trashed;
    case "trash": return t.trashed;
    default: return !t.trashed;
  }
}
