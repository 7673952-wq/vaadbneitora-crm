// Single source of truth for normalizing system codes and caller phones, plus
// the pure parsing / rule-evaluation logic behind the pticha/sgira email
// automation. Everything here is deterministic and browser-safe (no I/O), so
// it can be unit tested and reused on both sides.

/**
 * Digits only, leading zeros preserved. Deliberately no trimming, reversing or
 * fuzzy matching — the SQL side is exactly `regexp_replace(x, '\D', '', 'g')`.
 */
export function normalizeSystemCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Same normalization rule for phones (digits only, zeros preserved). */
export function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export type RequestType = "pticha" | "sgira";

export type ParsedRequest = {
  requestType: RequestType | null;
  requestNumber: string | null;
  systemCodeRaw: string | null;
  systemCodeNorm: string | null;
  callerPhone: string | null;
  callerPhoneNorm: string | null;
};

const TYPE_PATTERNS: Array<{ type: RequestType; re: RegExp }> = [
  { type: "pticha", re: /(pticha|ptixa|בקשת\s*פתיחה|פתיחת\s*מערכת|פתיחה)/i },
  { type: "sgira", re: /(sgira|sgirah|בקשת\s*סגירה|סגירת\s*מערכת|סגירה|חסימה)/i },
];

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/**
 * Parses a pticha/sgira request email. Tolerant of field order and of missing
 * fields — anything it cannot determine comes back as null so the caller can
 * route the request to the "needs decision" queue instead of guessing.
 */
export function parseRequestEmail(input: { subject?: string | null; body?: string | null }): ParsedRequest {
  const subject = String(input.subject ?? "");
  const body = String(input.body ?? "");
  const text = `${subject}\n${body}`;

  let requestType: RequestType | null = null;
  for (const { type, re } of TYPE_PATTERNS) {
    if (re.test(subject)) { requestType = type; break; }
  }
  if (!requestType) {
    for (const { type, re } of TYPE_PATTERNS) {
      if (re.test(body)) { requestType = type; break; }
    }
  }

  const requestNumber = firstMatch(text, [
    /(?:מספר\s*בקשה|מס['׳]?\s*בקשה|request\s*(?:number|no\.?|id))\s*[:\-]?\s*([A-Za-z0-9\-]{1,32})/i,
  ]);

  const systemCodeRaw = firstMatch(text, [
    /(?:מספר\s*מערכת|מזהה\s*מערכת|מס['׳]?\s*מערכת|system\s*(?:number|code|id))\s*[:\-]?\s*([0-9][0-9\-\s]{4,24})/i,
  ]);

  const callerPhone = firstMatch(text, [
    /(?:טלפון\s*(?:ה?פונה)?|מספר\s*פונה|נייד|phone|caller)\s*[:\-]?\s*(\+?[0-9][0-9\-\s]{6,20})/i,
  ]);

  const systemCodeNorm = systemCodeRaw ? normalizeSystemCode(systemCodeRaw) : null;
  const callerPhoneNorm = callerPhone ? normalizePhone(callerPhone) : null;

  return {
    requestType,
    requestNumber: requestNumber || null,
    systemCodeRaw: systemCodeRaw ? systemCodeRaw.trim() : null,
    systemCodeNorm: systemCodeNorm || null,
    callerPhone: callerPhone ? callerPhone.trim() : null,
    callerPhoneNorm: callerPhoneNorm || null,
  };
}

export type RequestRule = {
  id: string;
  crm_key: string;
  request_type: RequestType;
  from_status: string | null;
  action: "set_status" | "keep" | "needs_decision" | "ignore";
  to_status: string | null;
  is_active: boolean;
  sort_order: number;
};

export type RuleOutcome = {
  rule: RequestRule | null;
  action: RequestRule["action"];
  toStatus: string | null;
};

/**
 * Picks the rule for a request: an exact `from_status` match always wins over
 * the default rule (`from_status IS NULL`). No rule at all → needs_decision.
 */
export function evaluateRules(
  rules: RequestRule[],
  requestType: RequestType,
  currentStatus: string | null,
): RuleOutcome {
  const active = rules.filter((r) => r.is_active && r.request_type === requestType);
  const exact = active.find((r) => r.from_status !== null && r.from_status === currentStatus);
  const fallback = active.find((r) => r.from_status === null);
  const rule = exact ?? fallback ?? null;
  if (!rule) return { rule: null, action: "needs_decision", toStatus: null };
  return {
    rule,
    action: rule.action,
    toStatus: rule.action === "set_status" ? rule.to_status : null,
  };
}
