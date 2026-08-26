// Server-only helpers for the login one-time-code flow.
// The OTP is delivered through the SAME Yemot HaMashiach connection and the
// SAME dialing flow that the voice-message feature already uses
// (ivr2:0CRM/Phone/<phone> + CallExtensionBridging) — the only difference is
// the spoken content: the 8-digit login code instead of a system number.

import { createHash, randomInt } from "crypto";

const YM_BASE = "https://www.call2all.co.il/ym/api";

export const OTP_CODE_LENGTH = 8;

export function generateOtpCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(OTP_CODE_LENGTH, "0");
}

/** Codes are never stored in the clear — only a salted hash. */
export function hashOtpCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export function normalizePhone(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

/**
 * Calls the user and reads the one-time code digit by digit.
 * Mirrors the voice-message flow 1:1 (which is proven to reach the phone):
 * a per-phone extension under 0CRM/Phone holding a single TTS file, then a
 * bridged call to that extension.
 */
export async function sendOtpByPhone(phoneRaw: string, code: string): Promise<void> {
  const apiKey = (process.env.YEMOT_API_KEY || "").trim();
  if (!apiKey) throw new Error("מפתח ה־API של ימות המשיח לא מוגדר בשרת");
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new Error("לא הוגדר מספר טלפון לאימות");

  const headers = { authorization: apiKey, "Content-Type": "application/json" };
  const extensionPath = `ivr2:0CRM/Phone/${phone}`;

  // Strict call: throws with the provider's message on any failure.
  const post = async (endpoint: string, params: Record<string, string>) => {
    let res: Response;
    try {
      res = await fetch(`${YM_BASE}/${endpoint}`, {
        method: "POST", headers, body: JSON.stringify(params),
      });
    } catch (e: any) {
      throw new Error(`שגיאת רשת מול ימות המשיח: ${e?.message ?? e}`);
    }
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || json?.responseStatus !== "OK") {
      const msg = json?.message || json?.responseMessage || `הפעולה נכשלה (סטטוס ${res.status})`;
      throw new Error(`ימות המשיח (${endpoint}): ${msg}`);
    }
    return json;
  };

  // Best-effort call: housekeeping must never abort the send.
  const tryPost = async (endpoint: string, params: Record<string, string>) => {
    try {
      const res = await fetch(`${YM_BASE}/${endpoint}`, {
        method: "POST", headers, body: JSON.stringify(params),
      });
      try { return await res.json(); } catch { return null; }
    } catch (e: any) {
      console.warn(`[otp] ${endpoint} failed`, e?.message ?? e);
      return null;
    }
  };

  await post("UpdateExtension", { path: extensionPath });

  // The extension is keyed by phone only, so a previous voice message (wav +
  // "-Title.tts") or an older code may still sit there and get played too.
  // Purge everything before uploading the new code.
  const dir = await tryPost("GetIVR2Dir", { path: extensionPath });
  const stale: string[] = Array.isArray(dir?.files)
    ? dir.files.map((f: any) => String(f?.name ?? f?.fileName ?? "")).filter(Boolean)
    : [];
  for (const name of stale) {
    await tryPost("FileAction", { action: "delete", what: `${extensionPath}/${name}` });
  }

  // "!" between digits forces Yemot's TTS to read each digit separately.
  // The login code rides the exact voice-message flow, in file '004'.
  const spoken = code.split("").join("!");
  await post("UploadTextFile", {
    what: `${extensionPath}/004.tts`,
    contents: `קוד הכניסה שלך למערכת הוא ${spoken} . שוב, ${spoken}`,
  });

  await post("CallExtensionBridging", { phones: phone });
}
