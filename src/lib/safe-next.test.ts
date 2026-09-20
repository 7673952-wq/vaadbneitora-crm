import { describe, it, expect } from "vitest";
import { sanitizeNext, afterLoginTarget, currentNextParam, DEFAULT_AFTER_LOGIN } from "./safe-next";

describe("sanitizeNext", () => {
  it("keeps an internal path", () => {
    expect(sanitizeNext("/systems/abc")).toBe("/systems/abc");
  });

  it("keeps query params and hash (deep link with query survives)", () => {
    expect(sanitizeNext("/requests?req=123#top")).toBe("/requests?req=123#top");
  });

  it("rejects an external absolute URL", () => {
    expect(sanitizeNext("https://evil.example")).toBeNull();
  });

  it("rejects a protocol-relative path", () => {
    expect(sanitizeNext("//evil.example/x")).toBeNull();
    expect(sanitizeNext("/\\evil.example")).toBeNull();
  });

  it("rejects javascript: and relative paths", () => {
    expect(sanitizeNext("javascript:alert(1)")).toBeNull();
    expect(sanitizeNext("systems/abc")).toBeNull();
  });

  it("refuses to bounce back to the login screen", () => {
    expect(sanitizeNext("/auth")).toBeNull();
  });

  it("rejects empty and non-string input", () => {
    expect(sanitizeNext("")).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
    expect(sanitizeNext(42)).toBeNull();
  });

  it("falls back to the dashboard for anything unsafe", () => {
    expect(afterLoginTarget("https://evil.example")).toBe(DEFAULT_AFTER_LOGIN);
    expect(afterLoginTarget("/c/yemot/1")).toBe("/c/yemot/1");
  });

  it("builds the next param from a location", () => {
    expect(currentNextParam({ pathname: "/systems/9", search: "?tab=mail" })).toBe("/systems/9?tab=mail");
    expect(currentNextParam({ pathname: "/systems/9" })).toBe("/systems/9");
  });
});
