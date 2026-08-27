// Server-only helpers for the login one-time-code flow.
// The OTP call goes out through Yemot's RunCampaign API with a plain TTS text
// (this is ONLY the login code path — status voice messages are untouched).

import { createHash, randomInt, randomBytes } from "crypto";

const YM_BASE = "https://www.call2all.co.il/ym/api";

export const OTP_CODE_LENGTH = 8;

export function generateOtpCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(OTP_CODE_LENGTH, "0");
}

/** Codes are never stored in the clear — only a salted hash. */
export function hashOtpCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

/** One-time MFA grant handed out after a verified OTP (256-bit random). */
export function generateMfaGrant(): string {
  return randomBytes(32).toString("hex");
}

/** Grants are never stored in the clear — only their SHA-256 hash. */
export function hashMfaGrant(grant: string): string {
  return createHash("sha256").update(grant).digest("hex");
}

export function normalizePhone(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

/**
 * Digits must be spoken one by one: after the Yemot reform every digit needs
 * a space before, between and after it, otherwise the robot reads the number
 * as a whole quantity.
 */
export function spellDigits(value: string): string {
  return ` ${String(value).split("").join(" ")} `;
}

/** The spoken text: the code is always read twice — there is no replay. */
export function buildOtpText(code: string): string {
  const spoken = spellDigits(code);
  return `קוד האימות הוא:${spoken}. השמעה חוזרת:${spoken}`;
}

/**
 * Places the verification call through RunCampaign:
 *   phones = { "<phone>": { "text": "<spoken text>" } }
 */
export async function sendOtpByPhone(phoneRaw: string, code: string): Promise<void> {
  const apiKey = (process.env.YEMOT_API_KEY || "").trim();
  if (!apiKey) throw new Error("מפתח ה־API של ימות המשיח לא מוגדר בשרת");
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new Error("לא הוגדר מספר טלפון לאימות");

  const phones = { [phone]: { text: buildOtpText(code) } };

  let res: Response;
  try {
    res = await fetch(`${YM_BASE}/RunCampaign`, {
      method: "POST",
      headers: { authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ token: apiKey, phones: JSON.stringify(phones) }),
    });
  } catch (e: any) {
    throw new Error(`שגיאת רשת מול ימות המשיח: ${e?.message ?? e}`);
  }
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok || json?.responseStatus !== "OK") {
    const msg = json?.message || json?.responseMessage || `הפעולה נכשלה (סטטוס ${res.status})`;
    throw new Error(`ימות המשיח (RunCampaign): ${msg}`);
  }
}
