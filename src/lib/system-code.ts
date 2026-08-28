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

/**
 * The single comparison key for "is this the same system code?", used by the
 * email automation, by lookups and by the SQL unique index, which is exactly
 * `ltrim(regexp_replace(system_code, '\D', '', 'g'), '0')`.
 *
 * Leading zeros are stripped because the CRM stores short codes with a leading
 * "0" (`0882309477`) while the request emails send them bare (`882309477`) —
 * without this the same system would be matched as two different ones.
 */
export function systemCodeMatchKey(value: unknown): string {
  return normalizeSystemCode(value).replace(/^0+/, "");
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

  // The real emails write "מס. בקשה: 1516" (period, not apostrophe) and put
  // the number in the subject as "pticha-1516"; both forms are accepted.
  const requestNumber = firstMatch(text, [
    /(?:מספר\s*ה?בקשה|מס[.'׳]?\s*ה?בקשה|בקשה\s*מס[.'׳]?|request\s*(?:number|no\.?|id))\s*[:\-]?\s*([A-Za-z0-9\-]{1,32})/i,
    /\b(?:pticha|ptixa|sgira|sgirah)\s*[-_]\s*([0-9]{1,12})\b/i,
  ]);

  // The real emails write "מספר המערכת" (with ה) — the definite article is
  // optional everywhere below for the same reason.
  const systemCodeRaw = firstMatch(text, [
    /(?:מספר\s*ה?מערכת|מזהה\s*ה?מערכת|מס[.'׳]?\s*ה?מערכת|system\s*(?:number|code|id))\s*[:\-]?\s*([0-9][0-9\- ]{3,23})/i,
  ]);

  const callerPhone = firstMatch(text, [
    /(?:טלפון\s*(?:ה?פונה)?|מספר\s*ה?פונה|לזיהוי|נייד|phone|caller)\s*[:\-]?\s*(\+?[0-9][0-9\- ]{6,20})/i,
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
