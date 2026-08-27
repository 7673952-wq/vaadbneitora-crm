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

  it("removeItem clears both stores on sign-out", async () => {
    const mod = await loadModule();
    localStorage.setItem("crm_remember_device", "1");
    const storage = mod.rememberAwareStorage()!;
    storage.setItem(AUTH_KEY, "value");
    sessionStorage.setItem(AUTH_KEY, "value");

    storage.removeItem(AUTH_KEY);

    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
