import DOMPurify from "isomorphic-dompurify";

export function sanitizeText(input: string): string {
  if (typeof input !== "string") return input as unknown as string;
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

export function sanitizeOptional<T extends string | null | undefined>(input: T): T {
  if (input == null) return input;
  return sanitizeText(input as string) as T;
}
