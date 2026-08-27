// A first-party cookie store used as a DURABLE mirror for the auth session.
//
// Why: localStorage is not always durable. Inside an embedded/preview frame it
// is partitioned per embedder, and strict browser settings ("clear site data on
// close", ITP-style eviction) wipe it between browser launches. In those cases
// "זכור אותי" silently fails even though the code wrote the token correctly.
// A first-party cookie with an explicit Max-Age survives all of those cases.
//
// Values can exceed the ~4KB per-cookie limit, so they are written in chunks.

const MAX_CHUNK = 3000;
const MAX_CHUNKS = 8;

function secureFlag(): string {
  if (typeof location === "undefined") return "";
  return location.protocol === "https:" ? "; Secure" : "";
}

function writeRaw(name: string, value: string, maxAgeSeconds: number) {
  try {
    document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secureFlag()}`;
  } catch { /* cookies blocked */ }
}

function readRaw(name: string): string | null {
  try {
    const prefix = `${name}=`;
    for (const part of document.cookie.split("; ")) {
      if (part.startsWith(prefix)) return part.slice(prefix.length);
    }
  } catch { /* cookies blocked */ }
  return null;
}

function deleteRaw(name: string) {
  try {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`;
  } catch { /* cookies blocked */ }
}

/** Stores a (possibly long) value across numbered cookie chunks. */
export function setDurable(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(value);
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += MAX_CHUNK) chunks.push(encoded.slice(i, i + MAX_CHUNK));
  if (chunks.length > MAX_CHUNKS) { deleteDurable(name); return; }
  writeRaw(`${name}.n`, String(chunks.length), maxAgeSeconds);
  chunks.forEach((chunk, i) => writeRaw(`${name}.${i}`, chunk, maxAgeSeconds));
  for (let i = chunks.length; i < MAX_CHUNKS; i++) deleteRaw(`${name}.${i}`);
}

export function getDurable(name: string): string | null {
  if (typeof document === "undefined") return null;
  const count = Number(readRaw(`${name}.n`) ?? "0");
  if (!count || Number.isNaN(count)) return null;
  let out = "";
  for (let i = 0; i < count; i++) {
    const chunk = readRaw(`${name}.${i}`);
    if (chunk === null) return null; // an incomplete value is unusable
    out += chunk;
  }
  try { return decodeURIComponent(out); } catch { return null; }
}

export function deleteDurable(name: string) {
  if (typeof document === "undefined") return;
  deleteRaw(`${name}.n`);
  for (let i = 0; i < MAX_CHUNKS; i++) deleteRaw(`${name}.${i}`);
}

export function cookiesAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = "crm_cookie_probe";
    writeRaw(probe, "1", 30);
    const ok = readRaw(probe) === "1";
    deleteRaw(probe);
    return ok;
  } catch { return false; }
}
