export function stripQuotedEmail(text: string): string {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
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
  return normalized
    .slice(0, end)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}