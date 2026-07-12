import { sanitizeText } from "@/lib/sanitize";

export type AdditionalCallerPhone = {
  phone: string;
  sent_at?: string;
};

export function normalizeAdditionalCallerPhones(value: unknown): AdditionalCallerPhone[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    let parsed: any = entry;
    if (typeof entry === "string") {
      try {
        parsed = JSON.parse(entry);
      } catch {
        parsed = { phone: entry };
      }
    }
    const phone = sanitizeText(String(parsed?.phone ?? "")).trim();
    if (!phone) return [];
    const sentAt = typeof parsed?.sent_at === "string" ? parsed.sent_at : undefined;
    return [{ phone, ...(sentAt ? { sent_at: sentAt } : {}) }];
  });
}