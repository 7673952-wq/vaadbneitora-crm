import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { userId: string }) {
  const { assertAdminUserId } = await import("@/lib/admin-role.server");
  await assertAdminUserId(context.userId);
}

export const backupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { runBackup } = await import("@/lib/backups.server");
    return await runBackup();
  });

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: folders, error } = await supabaseAdmin.storage.from("backups").list("", {
      limit: 200,
      sortBy: { column: "name", order: "desc" },
    });
    if (error) throw new Error(error.message);
    const result: { folder: string; created_at: string; files: { name: string; size: number }[] }[] = [];
    for (const f of folders ?? []) {
      if (!f.name) continue;
      const { data: files } = await supabaseAdmin.storage.from("backups").list(f.name, { limit: 100 });
      result.push({
        folder: f.name,
        created_at: (f as any).created_at ?? "",
        files: (files ?? []).map((x) => ({ name: x.name, size: (x.metadata as any)?.size ?? 0 })),
      });
    }
    return result;
  });

export const getBackupFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) =>
    z.object({ path: z.string().min(1).max(500).regex(/^[A-Za-z0-9._\-/:]+$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage.from("backups").createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { folder: string }) =>
    z.object({ folder: z.string().min(1).max(200).regex(/^[A-Za-z0-9._\-:]+$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: files } = await supabaseAdmin.storage.from("backups").list(data.folder, { limit: 100 });
    const paths = (files ?? []).map((f) => `${data.folder}/${f.name}`);
    if (paths.length > 0) {
      const { error } = await supabaseAdmin.storage.from("backups").remove(paths);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
