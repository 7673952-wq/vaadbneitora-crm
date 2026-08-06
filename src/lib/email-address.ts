/** Parses `Name <a@b.com>` / `a@b.com` into a display name + address. */
export type ParsedAddress = { name: string; email: string };

export function parseEmailAddress(raw: string | null | undefined): ParsedAddress {
  const value = String(raw ?? "").trim();
  if (!value) return { name: "", email: "" };
  const angled = value.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (angled) {
    const name = angled[1].replace(/^["']|["']$/g, "").trim();
    const email = angled[2].trim().toLowerCase();
    return { name: name || emailToName(email), email };
  }
  const email = value.toLowerCase();
  return { name: emailToName(email), email };
}

/** Fallback display name derived from the local part: dana.levi → Dana Levi */
export function emailToName(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local) return "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function formatAddress(raw: string | null | undefined): string {
  const { name, email } = parseEmailAddress(raw);
  if (!email) return "";
  return name && name.toLowerCase() !== email ? `${name} <${email}>` : email;
}
