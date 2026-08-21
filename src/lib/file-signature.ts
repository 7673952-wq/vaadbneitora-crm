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
  if (rule && !rule.test(buf)) return "תוכן הקובץ אינו תואם לסוג הקובץ שהוצהר";
  return null;
}
