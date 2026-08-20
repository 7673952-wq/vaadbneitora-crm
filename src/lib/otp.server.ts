// Server-only helpers for the login one-time-code flow.
// The OTP is delivered through the SAME Yemot HaMashiach connection that the
// voice-message feature already uses (YEMOT_API_KEY) — no new provider.

import { createHash, randomInt } from "crypto";

const YM_BASE = "https://www.call2all.co.il/ym/api";

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
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
 * Mirrors the existing voice-message flow: a per-phone extension holding a
 * single TTS file, then a bridged call.
 */
export async function sendOtpByPhone(phoneRaw: string, code: string): Promise<void> {
  const apiKey = (process.env.YEMOT_API_KEY || "").trim();
  if (!apiKey) throw new Error("מפתח ה־API של ימות המשיח לא מוגדר בשרת");
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new Error("לא הוגדר מספר טלפון לאימות");

  const headers = { authorization: apiKey, "Content-Type": "application/json" };
  const extensionPath = `ivr2:0CRM/Otp/${phone}`;
  const post = async (endpoint: string, params: Record<string, string>) => {
    const res = await fetch(`${YM_BASE}/${endpoint}`, {
      method: "POST", headers, body: JSON.stringify(params),
    });
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok && json?.responseStatus === "OK", json };
  };

  await post("UpdateExtension", { path: extensionPath });
  // Clear anything left from a previous code for this phone.
  const dir = await post("GetIVR2Dir", { path: extensionPath });
  const stale: string[] = Array.isArray(dir.json?.files)
    ? dir.json.files.map((f: any) => String(f?.name ?? f?.fileName ?? "")).filter(Boolean)
    : [];
  for (const name of stale) {
    await post("FileAction", { action: "delete", what: `${extensionPath}/${name}` });
  }

  // "!" between digits forces Yemot's TTS to read each digit separately.
  const spoken = code.split("").join("!");
  const upload = await post("UploadTextFile", {
    what: `${extensionPath}/000.tts`,
    contents: `קוד הכניסה שלך למערכת הוא ${spoken} . שוב, ${spoken}`,
  });
  if (!upload.ok) throw new Error("שליחת קוד האימות נכשלה");

  const call = await post("CallExtensionBridging", { phones: phone });
  if (!call.ok) throw new Error("שליחת קוד האימות נכשלה");
}
