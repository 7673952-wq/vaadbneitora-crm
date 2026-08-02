export type EmailCleanupLevel = "none" | "light" | "standard" | "strict";

export const EMAIL_CLEANUP_LEVELS: Array<{ value: EmailCleanupLevel; label: string }> = [
  { value: "none", label: "ללא ניקוי" },
  { value: "light", label: "קל — שורות ציטוט" },
  { value: "standard", label: "רגיל — שרשור קודם" },
  { value: "strict", label: "מלא — גם כותרות וחתימות" },
];

function normalize(text: string) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

export function cleanEmailContent(text: string, level: EmailCleanupLevel = "standard"): string {
  const normalized = normalize(text);
  if (level === "none") return normalized;

  const withoutQuotedLines = normalized
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  if (level === "light") return withoutQuotedLines.replace(/\n{3,}/g, "\n\n").trim();

  const markers = [
    /^On .+wrote:$/im,
    /^בתאריך .+ כתב(?:ה)?:$/im,
    /^-{2,}\s*(?:Original Message|הודעה מקורית)\s*-{2,}$/im,
    /^From:\s.+$/im,
    /^מאת:\s.+$/im,
  ];
  let end = normalized.length;
  for (const marker of markers) {
    const match = marker.exec(normalized);
    if (match?.index !== undefined) end = Math.min(end, match.index);
  }
  let cleaned = normalized
    .slice(0, end)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (level === "strict") {
    cleaned = cleaned
      .replace(/^(?:From|To|Cc|Subject|Date|מאת|אל|נושא|תאריך):.*$/gim, "")
      .replace(/\n(?:--\s*|בברכה[,!]?|Best regards[,]?).*$/is, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return cleaned;
}

export function stripQuotedEmail(text: string): string {
  return cleanEmailContent(text, "standard");
}