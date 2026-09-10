import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractReportDescription, isKnownReportHeading, parseRequestEmail } from "./system-code";

/**
 * Loads ONLY the pure description helpers out of the Apps Script file so the
 * server and Gmail-side rules are proven to behave identically.
 */
function loadAppsScriptExtractor(): (body: string) => string {
  const src = readFileSync(resolve(process.cwd(), "apps-script/email-relay.gs"), "utf8");
  const pick = (name: string) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`missing ${name}`);
    let depth = 0, i = src.indexOf("{", start);
    for (; i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      if (src[i] === "}") { depth -= 1; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
  };
  const headStart = src.indexOf("var KNOWN_HEADINGS_ = [");
  const headEnd = src.indexOf("];", headStart) + 2;
  const code = `${src.slice(headStart, headEnd)}\n${pick("isKnownHeading_")}\n${pick("extractReportDescriptionFromText_")}\nreturn extractReportDescriptionFromText_;`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(code)() as (body: string) => string;
}

const BASE = "בקשה לפתיחת מערכת\nמספר מערכת: 0882309477\nטלפון פונה: 0527673952";
const CASES: Array<{ name: string; body: string; expected: string }> = [
  {
    name: "colon inside a sentence does not end the description",
    body: `${BASE}\nתאור הדיווח: הלקוח אמר: המערכת לא עונה\nוגם ביקש לחזור אליו`,
    expected: "הלקוח אמר: המערכת לא עונה\nוגם ביקש לחזור אליו",
  },
  {
    name: "a clock time like 12:30 stays inside the text",
    body: `${BASE}\nתאור הדיווח:\nהתקשר בשעה 12:30\nולא נענה`,
    expected: "התקשר בשעה 12:30\nולא נענה",
  },
  {
    name: "several lines are kept whole",
    body: `${BASE}\nתאור הדיווח: שורה ראשונה\nשורה שנייה\n\nשורה רביעית`,
    expected: "שורה ראשונה\nשורה שנייה\n\nשורה רביעית",
  },
  {
    name: "an unknown heading-like line is part of the text",
    body: `${BASE}\nתאור הדיווח: תיאור\nהערה חשובה: לחזור מחר\nסוף`,
    expected: "תיאור\nהערה חשובה: לחזור מחר\nסוף",
  },
  {
    name: "a real next heading ends the description",
    body: `${BASE}\nתאור הדיווח: תיאור קצר\nעוד שורה\nמספר בקשה: 1516\nטלפון: 050`,
    expected: "תיאור קצר\nעוד שורה",
  },
  {
    name: "a separator line ends the description",
    body: `${BASE}\nתאור הדיווח: תיאור\n-----\nחתימה`,
    expected: "תיאור",
  },
];

describe("report description parser — server", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(extractReportDescription(c.body)).toBe(c.expected);
      expect(parseRequestEmail({ subject: "pticha-1516", body: c.body }).reportDescription).toBe(c.expected);
    });
  }
  it("recognizes only the known headings", () => {
    expect(isKnownReportHeading("מספר בקשה: 12")).toBe(true);
    expect(isKnownReportHeading("מס. בקשה: 12")).toBe(true);
    expect(isKnownReportHeading("מספר המערכת: 0882309477")).toBe(true);
    expect(isKnownReportHeading("טלפון הפונה: 050")).toBe(true);
    expect(isKnownReportHeading("הערה חשובה: משהו")).toBe(false);
    expect(isKnownReportHeading("בשעה 12:30 התקשר")).toBe(false);
    expect(isKnownReportHeading("אמרתי: לא")).toBe(false);
  });
  it("returns null when the heading is missing", () => {
    expect(extractReportDescription(BASE)).toBeNull();
  });
});

describe("report description parser — Apps Script mirror", () => {
  const extract = loadAppsScriptExtractor();
  for (const c of CASES) {
    it(c.name, () => {
      expect(extract(c.body)).toBe(c.expected);
    });
  }
  it("returns '' when the heading is missing", () => {
    expect(extract(BASE)).toBe("");
  });
});
