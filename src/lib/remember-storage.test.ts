import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal Storage stub — enough for the adapter, which only uses
// getItem/setItem/removeItem/key/length.
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  } as unknown as Storage;
}

function installCookieDocument() {
  const jar = new Map<string, string>();
  (globalThis as any).document = {
    get cookie() {
      return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(raw: string) {
      const [pair, ...attributes] = raw.split(";");
      const separator = pair.indexOf("=");
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const deleted = attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0");
      if (deleted) jar.delete(key);
      else jar.set(key, value);
    },
  };
}

const AUTH_KEY = "sb-abcdef-auth-token";

async function loadModule() {
  vi.resetModules();
  return await import("./remember-storage");
}

describe("rememberAwareStorage", () => {
  beforeEach(() => {
    const local = makeStorage();
    const session = makeStorage();
    (globalThis as any).localStorage = local;
    (globalThis as any).sessionStorage = session;
    (globalThis as any).location = { hostname: "crm.vercel.app", search: "" };
    installCookieDocument();
    (globalThis as any).window = {
      localStorage: local,
      sessionStorage: session,
      location: (globalThis as any).location,
      parent: undefined,
    };
    (globalThis as any).window.parent = (globalThis as any).window;
  });

  it("keeps a remembered session in localStorage and clears the other copy", async () => {
    const mod = await loadModule();
    localStorage.setItem("crm_remember_device", "1");
    sessionStorage.setItem(AUTH_KEY, JSON.stringify({ refresh_token: "stale" }));

    const storage = mod.rememberAwareStorage()!;
    storage.setItem(AUTH_KEY, JSON.stringify({ refresh_token: "fresh" }));

    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_KEY)).toContain("fresh");
    expect(storage.getItem(AUTH_KEY)).toContain("fresh");
  });

  it("keeps an unremembered session out of localStorage", async () => {
    const mod = await loadModule();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ refresh_token: "stale" }));

    const storage = mod.rememberAwareStorage()!;
    storage.setItem(AUTH_KEY, JSON.stringify({ refresh_token: "fresh" }));

    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toContain("fresh");
  });

  it("setSessionPersistence drops every pre-existing token so none can compete", async () => {
    const mod = await loadModule();
    localStorage.setItem(AUTH_KEY, "old-local");
    sessionStorage.setItem(AUTH_KEY, "old-session");

    mod.setSessionPersistence(true);

    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
    expect(localStorage.getItem("crm_remember_device")).toBe("1");
  });

  it("an internal auth removal preserves the durable remembered-session mirror", async () => {
    const mod = await loadModule();
    localStorage.setItem("crm_remember_device", "1");
    const storage = mod.rememberAwareStorage()!;
    storage.setItem(AUTH_KEY, "value");
    sessionStorage.setItem(AUTH_KEY, "value");

    storage.removeItem(AUTH_KEY);

    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toBe("value");
    expect(mod.authStorageDiagnostics()?.cookieMirror).toBe(true);
  });

  it("an explicit sign-out clears both stores, the flag, and the mirror", async () => {
    const mod = await loadModule();
    mod.setSessionPersistence(true);
    const storage = mod.rememberAwareStorage()!;
    storage.setItem(AUTH_KEY, "value");
    sessionStorage.setItem(AUTH_KEY, "stale-value");

    mod.clearPersistedSession();

    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
    expect(localStorage.getItem("crm_remember_device")).toBeNull();
    expect(mod.authStorageDiagnostics()?.cookieMirror).toBe(false);
  });

  it("keeps the chosen mode stable until the login form explicitly changes it", async () => {
    localStorage.setItem("crm_remember_device", "1");
    const mod = await loadModule();
    const storage = mod.rememberAwareStorage()!;

    // Simulate an unrelated tab changing the raw marker during this client's
    // lifetime. This adapter must keep writing to its originally selected store.
    localStorage.removeItem("crm_remember_device");
    storage.setItem(AUTH_KEY, "stable-local-session");

    expect(localStorage.getItem(AUTH_KEY)).toBe("stable-local-session");
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("switches an existing adapter only through setSessionPersistence", async () => {
    const mod = await loadModule();
    const storage = mod.rememberAwareStorage()!;

    mod.setSessionPersistence(true);
    storage.setItem(AUTH_KEY, "remembered-session");

    expect(localStorage.getItem(AUTH_KEY)).toBe("remembered-session");
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("restores a remembered session from its durable mirror in a new window", async () => {
    localStorage.setItem("crm_remember_device", "1");
    const firstModule = await loadModule();
    const firstStorage = firstModule.rememberAwareStorage()!;
    firstStorage.setItem(AUTH_KEY, JSON.stringify({ refresh_token: "durable" }));

    // A new window gets a fresh sessionStorage. Simulate the reported browser
    // behavior where localStorage is unexpectedly unavailable at startup too.
    localStorage.removeItem(AUTH_KEY);
    (globalThis as any).sessionStorage = makeStorage();
    (globalThis as any).window.sessionStorage = (globalThis as any).sessionStorage;

    const secondModule = await loadModule();
    const secondStorage = secondModule.rememberAwareStorage()!;

    expect(secondStorage.getItem(AUTH_KEY)).toContain("durable");
    expect(localStorage.getItem(AUTH_KEY)).toContain("durable");
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
