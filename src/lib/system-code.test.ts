import { describe, expect, it } from "vitest";
import { evaluateRules, normalizePhone, normalizeSystemCode, parseRequestEmail, type RequestRule } from "@/lib/system-code";

describe("normalizeSystemCode / normalizePhone", () => {
  it("keeps leading zeros and strips separators", () => {
    expect(normalizeSystemCode("079-518-1000")).toBe("0795181000");
    expect(normalizePhone("+972 52-767-3952")).toBe("972527673952");
    expect(normalizeSystemCode(null)).toBe("");
  });
});

describe("parseRequestEmail", () => {
  it("parses a pticha request", () => {
    const p = parseRequestEmail({
      subject: "בקשת פתיחה חדשה",
      body: "מספר בקשה: 12345\nמספר מערכת: 079-5181000\nטלפון פונה: 052-7673952",
    });
    expect(p.requestType).toBe("pticha");
    expect(p.requestNumber).toBe("12345");
    expect(p.systemCodeNorm).toBe("0795181000");
    expect(p.callerPhoneNorm).toBe("0527673952");
  });

  it("parses a sgira request and tolerates missing fields", () => {
    const p = parseRequestEmail({ subject: "sgira request", body: "no details here" });
    expect(p.requestType).toBe("sgira");
    expect(p.systemCodeNorm).toBeNull();
    expect(p.callerPhoneNorm).toBeNull();
  });

  it("returns null type when nothing matches", () => {
    expect(parseRequestEmail({ subject: "hello", body: "world" }).requestType).toBeNull();
  });
});

describe("evaluateRules", () => {
  const base = { crm_key: "yemot", is_active: true, sort_order: 0 } as const;
  const rules: RequestRule[] = [
    { id: "a", ...base, request_type: "pticha", from_status: null, action: "set_status", to_status: "open" },
    { id: "b", ...base, request_type: "pticha", from_status: "closed", action: "needs_decision", to_status: null },
    { id: "c", ...base, request_type: "sgira", from_status: null, action: "ignore", to_status: null },
    { id: "d", ...base, request_type: "sgira", from_status: "open", action: "set_status", to_status: "closed", is_active: false },
  ];

  it("prefers an exact from_status match over the default rule", () => {
    expect(evaluateRules(rules, "pticha", "closed").rule?.id).toBe("b");
  });

  it("falls back to the default rule", () => {
    const r = evaluateRules(rules, "pticha", "open");
    expect(r.rule?.id).toBe("a");
    expect(r.toStatus).toBe("open");
  });

  it("skips inactive rules", () => {
    expect(evaluateRules(rules, "sgira", "open").rule?.id).toBe("c");
  });

  it("needs a decision when no rule matches", () => {
    expect(evaluateRules([], "pticha", "open").action).toBe("needs_decision");
  });
});

describe("parseRequestEmail — real production email", () => {
  // Copied verbatim from a real incoming request email.
  const real = {
    subject: "הכנסת נתונים pticha-1516 לזיהוי 0527122642",
    body: [
      "מס. בקשה: 1516",
      "מספר המערכת: 882309477",
      "טלפון הפונה: 0527122642",
    ].join("\n"),
  };

  it("parses the exact production format", () => {
    const p = parseRequestEmail(real);
    expect(p.requestType).toBe("pticha");
    expect(p.requestNumber).toBe("1516");
    expect(p.systemCodeNorm).toBe("882309477");
    expect(p.callerPhoneNorm).toBe("0527122642");
  });

  it("does not swallow the next line into the system code", () => {
    const p = parseRequestEmail({
      subject: "sgira-22",
      body: "מספר המערכת: 882309477\n0527122642",
    });
    expect(p.systemCodeNorm).toBe("882309477");
  });
});

describe("systemCodeMatchKey", () => {
  it("matches a stored 0-prefixed code with the bare code from an email", () => {
    expect(systemCodeMatchKey("0882309477")).toBe(systemCodeMatchKey("882309477"));
  });

  it("returns an empty key for codes with no digits", () => {
    expect(systemCodeMatchKey("cat-abc")).toBe("");
  });
});
