import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Apps Script isn't importable, so the pure helpers behind `send_notification`
// are evaluated straight out of the .gs source, the same way
// apps-script-html.test.ts already does for html_/escapeHtml_.
const src = readFileSync(resolve(process.cwd(), "apps-script/email-relay.gs"), "utf8");

function extractFn(name: string): string {
  const re = new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n}`);
  const match = src.match(re)?.[0];
  if (!match) throw new Error(`could not find function ${name} in email-relay.gs`);
  return match;
}

const escapeHtmlSrc = extractFn("escapeHtml_");
const htmlSrc = src.match(/function html_\(s\)[^\n]*/)?.[0] ?? "";
const isAllowedSrc = extractFn("isAllowedNotificationUrl_");
const buildHtmlSrc = extractFn("buildNotificationHtml_");

// eslint-disable-next-line no-new-func
const isAllowedNotificationUrl_ = new Function(
  `${isAllowedSrc}\nreturn isAllowedNotificationUrl_;`,
)() as (url: string, baseUrl: string) => { ok: boolean; error?: string };

// eslint-disable-next-line no-new-func
const buildNotificationHtml_ = new Function(
  `${escapeHtmlSrc}\n${htmlSrc}\n${buildHtmlSrc}\nreturn buildNotificationHtml_;`,
)() as (fields: Record<string, unknown>) => string;

const BASE_URL = "https://vaadbneitora-crm.vercel.app";

describe("isAllowedNotificationUrl_", () => {
  it("accepts a url under the configured base", () => {
    expect(isAllowedNotificationUrl_(`${BASE_URL}/c/foo/123`, BASE_URL)).toEqual({ ok: true });
  });

  it("accepts the base url itself with no extra path", () => {
    expect(isAllowedNotificationUrl_(BASE_URL, BASE_URL)).toEqual({ ok: true });
  });

  it("rejects a different host", () => {
    const result = isAllowedNotificationUrl_("https://evil.example.com/c/foo/123", BASE_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/host/);
  });

  it("rejects a host that merely starts with the base host", () => {
    const result = isAllowedNotificationUrl_("https://vaadbneitora-crm.vercel.app.evil.com/x", BASE_URL);
    expect(result.ok).toBe(false);
  });

  it("rejects http", () => {
    const result = isAllowedNotificationUrl_(`http://vaadbneitora-crm.vercel.app/c/foo/123`, BASE_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/https/);
  });

  it("rejects javascript: urls", () => {
    const result = isAllowedNotificationUrl_(`javascript:alert(1)`, BASE_URL);
    expect(result.ok).toBe(false);
  });

  it("rejects a path outside the configured base path", () => {
    const scoped = `${BASE_URL}/app`;
    const result = isAllowedNotificationUrl_(`${BASE_URL}/other/123`, scoped);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/path/);
  });

  it("rejects a path that only shares a string prefix with the base path", () => {
    const scoped = `${BASE_URL}/app`;
    const result = isAllowedNotificationUrl_(`${BASE_URL}/app-evil/x`, scoped);
    expect(result.ok).toBe(false);
  });

  it("accepts a nested path under a scoped base path", () => {
    const scoped = `${BASE_URL}/app`;
    expect(isAllowedNotificationUrl_(`${BASE_URL}/app/c/1`, scoped).ok).toBe(true);
  });

  it("errors clearly when APP_BASE_URL is not configured", () => {
    const result = isAllowedNotificationUrl_(`${BASE_URL}/c/1`, "");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/APP_BASE_URL/);
  });
});

describe("buildNotificationHtml_", () => {
  it("escapes HTML injection attempts in every field", () => {
    const html = buildNotificationHtml_({
      actorName: '<img src=x onerror=alert(1)>',
      bodyText: '<script>alert("x")</script>',
      contextTitle: '"><b>hi</b>',
      buttonUrl: `${BASE_URL}/c/1"><script>1</script>`,
      buttonLabel: '<i>click</i>',
    });
    expect(html).not.toMatch(/<img/);
    expect(html).not.toMatch(/<script>/);
    expect(html).not.toMatch(/<b>hi<\/b>/);
    expect(html).not.toMatch(/<i>click<\/i>/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a single call-to-action button when buttonUrl is given", () => {
    const html = buildNotificationHtml_({
      actorName: "דנה",
      bodyText: "תייגה אותך",
      contextTitle: "מערכת X",
      buttonUrl: `${BASE_URL}/c/1`,
      buttonLabel: "לצפייה",
    });
    const anchorCount = (html.match(/<a /g) || []).length;
    expect(anchorCount).toBe(1);
    expect(html).toContain(`href="${BASE_URL}/c/1"`);
    expect(html).toContain('dir="rtl"');
  });

  it("omits the button entirely when no buttonUrl is given", () => {
    const html = buildNotificationHtml_({ bodyText: "שלום" });
    expect(html).not.toContain("<a ");
  });

  it("keeps line breaks in the body text", () => {
    const html = buildNotificationHtml_({ bodyText: "שורה א\nשורה ב" });
    expect(html).toContain("שורה א<br>שורה ב");
  });
});

describe("send_notification dispatcher wiring", () => {
  it("registers the send_notification action in doPost", () => {
    expect(src).toMatch(/d\.action === 'send_notification'/);
  });

  it("defines sendNotification_ with required-field validation", () => {
    const fnSrc = extractFn("sendNotification_");
    expect(fnSrc).toMatch(/missing to/);
    expect(fnSrc).toMatch(/missing subject/);
    expect(fnSrc).toMatch(/missing text/);
  });
});
