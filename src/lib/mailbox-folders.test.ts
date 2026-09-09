import { describe, it, expect } from "vitest";
import { applyThreadFiling, threadInFolder, MAIL_FOLDERS } from "@/lib/mailbox-prefs";

const base = { unread: 0, hasInbound: true, hasOutbound: false, starred: false, archived: false, spam: false, trashed: false };

describe("mailbox filing", () => {
  it("moving to spam clears archive and trash", () => {
    const r = applyThreadFiling({ starred: true, archived: true, spam: false, trashed: true }, { spam: true });
    expect(r).toEqual({ starred: true, archived: false, spam: true, trashed: false });
  });

  it("starring does not move the conversation", () => {
    const r = applyThreadFiling({ starred: false, archived: true, spam: false, trashed: false }, { starred: true });
    expect(r).toEqual({ starred: true, archived: true, spam: false, trashed: false });
  });

  it("an archived conversation leaves the inbox", () => {
    expect(threadInFolder({ ...base, archived: true }, "inbox")).toBe(false);
    expect(threadInFolder({ ...base, archived: true }, "archive")).toBe(true);
  });

  it("trash hides a conversation from every other folder", () => {
    const t = { ...base, unread: 2, starred: true, trashed: true };
    for (const f of MAIL_FOLDERS) {
      expect(threadInFolder(t, f)).toBe(f === "trash");
    }
  });

  it("unread counts only conversations still in the inbox", () => {
    expect(threadInFolder({ ...base, unread: 1 }, "unread")).toBe(true);
    expect(threadInFolder({ ...base, unread: 1, spam: true }, "unread")).toBe(false);
  });
});
