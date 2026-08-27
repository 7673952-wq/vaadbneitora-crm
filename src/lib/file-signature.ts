// Content-sniffing guard: the declared MIME type comes from the browser and
// can be forged, so we also check the file's real magic bytes before storing
// it. Anything whose bytes look like HTML/SVG/script is rejected outright.

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => buf[offset + i] === b);
}

const SIGNATURES: { mime: RegExp; test: (b: Uint8Array) => boolean }[] = [
  { mime: /^image\/png$/, test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  { mime: /^image\/jpeg$/, test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: /^image\/gif$/, test: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  { mime: /^image\/webp$/, test: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8) },
  { mime: /^application\/pdf$/, test: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]) },
  // zip container: xlsx / docx / zip
  {
    mime: /^application\/(zip|vnd\.openxmlformats-officedocument\.)/,
    test: (b) => startsWith(b, [0x50, 0x4b]),
  },
];

/** Returns an error message, or null when the bytes look acceptable. */
export function validateFileSignature(buf: Uint8Array, mime: string): string | null {
  if (buf.byteLength === 0) return "הקובץ ריק";

  // Reject active content regardless of the declared type.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(buf.slice(0, 512))
    .trim()
    .toLowerCase();
  if (/^(<!doctype html|<html|<svg|<\?xml[^>]*>\s*<svg|<script)/.test(head)) {
    return "תוכן הקובץ אינו נתמך מטעמי אבטחה";
  }

  const rule = SIGNATURES.find((s) => s.mime.test(mime));
  if (rule) {
    return rule.test(buf) ? null : "תוכן הקובץ אינו תואם לסוג הקובץ שהוצהר";
  }

  // An empty or generic declared type ("", application/octet-stream) proves
  // nothing, so the BYTES must match one of the formats we accept. Plain
  // text/CSV is allowed as long as it decodes cleanly and has no NUL bytes.
  const generic = !mime || /^application\/octet-stream$/i.test(mime);
  if (generic) {
    const known = SIGNATURES.some((s) => s.test(buf));
    if (known) return null;
    const sample = buf.slice(0, 1024);
    const printable = !sample.includes(0)
      && new TextDecoder("utf-8", { fatal: false }).decode(sample).indexOf("\uFFFD") === -1;
    if (printable) return null;
    return "לא ניתן לזהות את סוג הקובץ — העלה קובץ בפורמט נתמך";
  }
  return null;
}
