import { describe, it, expect } from "vitest";
import { queueUrlsFromStatus, queueInfoFromStatus, classifyQueueProbe } from "./queue-status";

describe("queueUrlsFromStatus", () => {
  it("parses the real shape", () => {
    const status = {
      voice: { url: "https://a.example.com/voice", armed: true, pending: 1, token_configured: true, updated_at: "x" },
      mention: { url: "https://a.example.com/mention", armed: false, pending: 0, token_configured: false, updated_at: "x" },
    };
    expect(queueUrlsFromStatus(status)).toEqual({
      voice_queue: "https://a.example.com/voice",
      mention_queue: "https://a.example.com/mention",
    });
  });

  it("parses the legacy wrapper shape", () => {
    const status = {
      queues: {
        voice_queue: { url: "https://legacy.example.com/voice" },
        mention_queue: { url: "https://legacy.example.com/mention" },
      },
    };
    expect(queueUrlsFromStatus(status)).toEqual({
      voice_queue: "https://legacy.example.com/voice",
      mention_queue: "https://legacy.example.com/mention",
    });
  });

  it("returns null when url is missing", () => {
    expect(queueUrlsFromStatus({})).toEqual({ voice_queue: null, mention_queue: null });
    expect(queueUrlsFromStatus({ voice: {}, mention: {} })).toEqual({ voice_queue: null, mention_queue: null });
    expect(queueUrlsFromStatus(null)).toEqual({ voice_queue: null, mention_queue: null });
  });
});

describe("queueInfoFromStatus", () => {
  it("extracts token/armed/pending from the real shape", () => {
    const status = { voice: { url: "https://x/y", armed: true, pending: 3, token_configured: true } };
    expect(queueInfoFromStatus(status, "voice_queue")).toEqual({
      url: "https://x/y",
      tokenConfigured: true,
      armed: true,
      pending: 3,
    });
  });

  it("defaults gracefully when missing", () => {
    expect(queueInfoFromStatus({}, "mention_queue")).toEqual({
      url: null,
      tokenConfigured: false,
      armed: false,
      pending: 0,
    });
  });
});

describe("classifyQueueProbe", () => {
  it("200 is reachable", () => {
    expect(classifyQueueProbe(200)).toEqual({ reachable: true });
  });
  it("405 is reachable", () => {
    expect(classifyQueueProbe(405)).toEqual({ reachable: true });
  });
  it("401 reports bad token/permission", () => {
    expect(classifyQueueProbe(401)).toEqual({ reachable: false, error: "טוקן או הרשאה שגויים" });
  });
  it("403 reports bad token/permission", () => {
    expect(classifyQueueProbe(403)).toEqual({ reachable: false, error: "טוקן או הרשאה שגויים" });
  });
  it("404 reports url not found", () => {
    expect(classifyQueueProbe(404)).toEqual({ reachable: false, error: "הכתובת לא נמצאה — יש להגדיר מחדש" });
  });
  it("other status codes report a generic error with code", () => {
    const res = classifyQueueProbe(500);
    expect(res.reachable).toBe(false);
    expect(res.error).toContain("500");
  });
  it("network failure reports a network error", () => {
    expect(classifyQueueProbe(undefined, "fetch failed")).toEqual({ reachable: false, error: "שגיאת רשת" });
  });
});
