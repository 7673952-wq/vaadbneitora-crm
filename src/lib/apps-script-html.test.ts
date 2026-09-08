import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The relay script is Apps Script (not importable), so the two helpers are
// evaluated straight out of the file. This guards the escaping fix: the CRM
// composer sends plain text, and it must never turn into live markup.
const src = readFileSync(resolve(process.cwd(), "apps-script/email-relay.gs"), "utf8");
const escapeSrc = src.match(/function escapeHtml_\(s\)[\s\S]*?\n}/)?.[0] ?? "";
const htmlSrc = src.match(/function html_\(s\)[^\n]*/)?.[0] ?? "";
// eslint-disable-next-line no-new-func
const html_ = new Function(`${escapeSrc}\n${htmlSrc}\nreturn html_;`)() as (s: string) => string;

describe("apps-script html_", () => {
  it("escapes markup instead of emitting it", () => {
    expect(html_('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands once", () => {
    expect(html_("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("keeps line breaks", () => {
    expect(html_("שלום\nעולם")).toBe("שלום<br>עולם");
    expect(html_("a\r\nb")).toBe("a<br>b");
  });

  it("handles empty input", () => {
    expect(html_("")).toBe("");
  });
});
