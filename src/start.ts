import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { getAccessToken } from "@/lib/session-cache";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Project-specific bearer attacher: reads the token from the module-level
// session cache instead of calling supabase.auth.getSession() (a brokered
// storage roundtrip in previews) on every single RPC.
const attachCachedSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    if (typeof window === "undefined") return next();
    const token = await getAccessToken();
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);

export const startInstance = createStart(() => ({
  functionMiddleware: [attachCachedSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
