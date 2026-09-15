import { describe, it, expect } from "vitest";
import {
  collectMentionPayload,
  mentionsStillInText,
  deriveMentionsFromText,
  type MentionPick,
} from "@/lib/mention-ids";

describe("mentionsStillInText", () => {
  it("keeps a pick only while its @name still appears in the body", () => {
    const picks: MentionPick[] = [
      { id: "1", name: "דני כהן" },
      { id: "2", name: "רותי" },
    ];
    const body = "שלום @דני כהן, תבדוק את זה";
    const kept = mentionsStillInText(body, picks);
    expect(kept).toEqual([{ id: "1", name: "דני כהן" }]);
  });

  it("keeps an @כולם pick while it still appears in the text", () => {
    const picks: MentionPick[] = [{ all: true }];
    expect(mentionsStillInText("היי @כולם בואו נדבר", picks)).toEqual([{ all: true }]);
    expect(mentionsStillInText("היי כולם בואו נדבר", picks)).toEqual([]);
  });
});

describe("collectMentionPayload", () => {
  it("dedupes repeated ids and sets mentionAll once", () => {
    const picks: MentionPick[] = [
      { id: "1", name: "דני" },
      { id: "1", name: "דני" },
      { id: "2", name: "רותי" },
      { all: true },
    ];
    expect(collectMentionPayload(picks)).toEqual({
      mentionedUserIds: ["1", "2"],
      mentionAll: true,
    });
  });

  it("drops ids that were filtered out because their @name left the text", () => {
    const picks: MentionPick[] = [{ id: "1", name: "דני" }];
    const stillThere = mentionsStillInText("אין תיוג כאן יותר", picks);
    expect(collectMentionPayload(stillThere)).toEqual({ mentionedUserIds: [], mentionAll: false });
  });

  it("ignores picks with an empty id", () => {
    expect(collectMentionPayload([{ id: "", name: "x" } as any])).toEqual({
      mentionedUserIds: [],
      mentionAll: false,
    });
  });
});

describe("deriveMentionsFromText", () => {
  const agents = [
    { id: "a1", name: "דני" },
    { id: "a2", name: "דני כהן" },
    { id: "a3", name: "רותי" },
  ];

  it("checks the longest name first, so it appears before its shorter substring in the result", () => {
    const result = deriveMentionsFromText("תודה @דני כהן על העזרה", agents);
    expect(result.mentionedUserIds[0]).toBe("a2");
    expect(result.mentionedUserIds).toContain("a1");
  });

  it("finds every distinct mentioned agent, deduped (each id appears once even if @name repeats)", () => {
    const result = deriveMentionsFromText("@רותי ו@רותי ו@בלבד", agents);
    expect(result.mentionedUserIds).toEqual(["a3"]);
  });

  it("sets mentionAll from @כולם and still finds other agents", () => {
    const result = deriveMentionsFromText("@כולם וגם @רותי בבקשה", agents);
    expect(result.mentionAll).toBe(true);
    expect(result.mentionedUserIds).toEqual(["a3"]);
  });

  it("returns nothing for plain text with no mentions", () => {
    const result = deriveMentionsFromText("אין כאן תיוג", agents);
    expect(result).toEqual({ mentionedUserIds: [], mentionAll: false });
  });
});
