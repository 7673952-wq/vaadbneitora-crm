// Pure text sanitizer — strips all HTML tags and decodes basic entities.
// Avoids isomorphic-dompurify/jsdom (which pulls css-tree and breaks bundling
// on Vercel/Nitro due to runtime JSON requires like ../data/patch.json).

function stripTags(input: string): string {
  // Remove script/style blocks entirely (including their contents)
  let out = input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Remove any remaining tags
  out = out.replace(/<\/?[^>]+>/g, "");
  // Decode a small set of common HTML entities
  out = out
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return out;
}

export function sanitizeText(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  return stripTags(input);
}

export function sanitizeOptional<T extends string | null | undefined>(input: T): T {
  if (input == null) return input;
  return sanitizeText(input as string) as T;
}
