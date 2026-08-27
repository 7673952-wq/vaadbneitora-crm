// Server-only helpers for the login one-time-code flow.
// The OTP is delivered through the SAME Yemot HaMashiach connection and the
// SAME dialing flow that the voice-message feature already uses
// (ivr2:0CRM/Phone/<phone> + CallExtensionBridging) — the only difference is
// the spoken content: the 8-digit login code instead of a system number.

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
 * Base recording copied into the caller's extension, exactly like the working
 * voice-message flow (`ivr2:0CRM/files/<n>.wav`). The API key is only allowed
 * to write the "<fileId>-Title.tts" companion of a copied file — uploading a
 * standalone "<n>.tts" is rejected with API_KEY_ACL_REJECT, which is a key
 * permission matter, not a filename matter.
 */
function otpTemplateFile(): string {
  const raw = String(process.env.YEMOT_OTP_TEMPLATE || "4").trim();
  return /^\d+$/.test(raw) ? raw : "4";
}

/**
 * Calls the user and reads the one-time code digit by digit.
 * Mirrors the voice-message flow 1:1 (which is proven to reach the phone):
 * copy the base wav into the per-phone extension, write its Title TTS with the
 * spoken code, then place a bridged call to that extension.
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
      // Surface ACL rejections as what they are: the API key lacks permission
      // for this operation/path. Renaming files will not fix it.
      if (String(msg).includes("API_KEY_ACL_REJECT")) {
        throw new Error(
          `ימות המשיח (${endpoint}): למפתח ה־API אין הרשאה לפעולה זו (API_KEY_ACL_REJECT) — יש להרחיב את הרשאות המפתח בימות המשיח`,
        );
      }
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

  // Copy the approved base recording into the extension — this is the step
  // that yields a fileId whose "-Title.tts" the API key IS allowed to write.
  const templateFile = otpTemplateFile();
  const copyJson = await post("FileAction", {
    what: `ivr2:0CRM/files/${templateFile}.wav`,
    target: extensionPath,
  });
  const copiedTarget = String(copyJson?.reports?.[0]?.target || copyJson?.target || "");
  const fileId = copiedTarget.match(/\/([^/]+)\.wav$/i)?.[1];
  if (!fileId) {
    throw new Error(
      `ימות המשיח (FileAction): לא התקבל מזהה קובץ לשליחת קוד הכניסה (שלוחה ${extensionPath})`,
    );
  }

  // "!" between digits forces Yemot's TTS to read each digit separately.
  const spoken = code.split("").join("!");
  await post("UploadTextFile", {
    what: `${extensionPath}/${fileId}-Title.tts`,
    contents: `קוד הכניסה שלך למערכת הוא ${spoken} . שוב, ${spoken}`,
  });

  await post("CallExtensionBridging", { phones: phone });
}
