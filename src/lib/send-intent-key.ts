// Client-safe helper: keeps ONE idempotency key alive for a given "send
// intent" (a compose/reply draft) across refreshes/reopens of the same tab,
// so a resend after a network hiccup reuses the key instead of minting a
// new one — which is what lets the server tell "the same click twice" apart
// from "a genuinely new message". A fresh key is only minted once the
// previous send is known to be done (success or duplicate).

function sanitizeScope(scope: string): string {
  return scope.replace(/[^A-Za-z0-9_\-:.]/g, "_").slice(0, 60);
}

function randomToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function storageKeyFor(scope: string): string {
  return `send-intent:${scope}`;
}

/**
 * Reads the key for `scope` from sessionStorage, creating one on first call.
 * Must be called when the compose UI OPENS, not on submit, so a page
 * refresh mid-compose reuses the same key on the eventual submit/retry.
 */
export function getSendIntentKey(scope: string): string {
  const safeScope = sanitizeScope(scope);
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    // SSR / no storage: can't persist across requests, but still return a
    // syntactically valid key so the caller never breaks.
    return `${safeScope}-${randomToken()}`;
  }
  const storageKey = storageKeyFor(scope);
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const key = `${safeScope}-${randomToken()}`;
  window.sessionStorage.setItem(storageKey, key);
  return key;
}

/** Call only after a send is known to be finished (success or duplicate). */
export function clearSendIntentKey(scope: string): void {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") return;
  window.sessionStorage.removeItem(storageKeyFor(scope));
}
