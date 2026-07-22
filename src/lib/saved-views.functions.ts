import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SavedViewFilters = {
  status?: string;
  secondaryStatus?: string;
  agentId?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

export const listSavedViews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("dashboard_saved_views" as any)
      .select("id, name, filters, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string; filters: SavedViewFilters; created_at: string }[];
  });

export const createSavedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; filters: SavedViewFilters }) =>
    z.object({
      name: z.string().min(1).max(80),
      filters: z.record(z.string(), z.any()),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("dashboard_saved_views" as any)
      .insert({ user_id: context.userId, name: data.name.trim(), filters: data.filters })
      .select("id, name, filters, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSavedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("dashboard_saved_views" as any).delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
