/**
 * Where to send the user after a login that started from a deep link.
 *
 * Deep links in notification e-mails point at real screens (`/systems/:id`,
 * `/c/:crm/:id`). When the browser has no session the guard sends the user to
 * the login screen with the intended path in `?next=` — and only an INTERNAL
 * path may ever be honoured, or the parameter becomes an open redirect.
 */

/** The screen a user lands on when there is no (valid) deep-link target. */
export const DEFAULT_AFTER_LOGIN = "/dashboard";

/**
 * Returns the path to navigate to after login, or null when the candidate is
 * not a safe internal path. Rejects absolute URLs, protocol-relative `//host`
 * paths, and anything that does not start with a single `/`.
 */
export function sanitizeNext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  // Must be a root-relative path. "//evil.example" is protocol-relative — the
  // browser would treat it as another origin.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // "/\evil.example" is normalised to a protocol-relative URL by some browsers.
  if (value.startsWith("/\\")) return null;
  // A scheme can only appear here through encoding tricks; reject control chars
  // and anything that parses with its own origin.
  if (/[\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.origin !== "https://internal.invalid") return null;
    // Never bounce back into the login screen itself.
    if (url.pathname === "/auth") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** The destination to use after a successful login. */
export function afterLoginTarget(raw: unknown): string {
  return sanitizeNext(raw) ?? DEFAULT_AFTER_LOGIN;
}

/** Builds the `next` value for the current location (path + query + hash). */
export function currentNextParam(location: { pathname: string; search?: string; hash?: string }): string {
  return `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
}
