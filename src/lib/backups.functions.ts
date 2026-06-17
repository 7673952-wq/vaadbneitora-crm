import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// All authorization in this file goes through `assertRole` from
// @/lib/permissions.server — single source of truth.
async function assertAdmin(context: { userId: string }) {
  const { assertRole } = await import("@/lib/permissions.server");
  await assertRole(context.userId, "admin");
}

async function assertSuperAdmin(context: { userId: string }) {
  const { assertRole } = await import("@/lib/permissions.server");
  await assertRole(context.userId, "super_admin");
}

export const backupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).optional().parse(d))
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

// Build a ZIP of an entire backup folder server-side and return a signed URL.
// Done server-side because fetching individual signed URLs from the browser to
// stitch a ZIP triggers CORS preflight that Supabase Storage doesn't allow.
export const getBackupZipUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { folder: string }) =>
    z.object({ folder: z.string().min(1).max(200).regex(/^[A-Za-z0-9._\-:]+$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const JSZip = (await import("jszip")).default;

    const { data: files, error: listErr } = await supabaseAdmin.storage
      .from("backups")
      .list(data.folder, { limit: 100 });
    if (listErr) throw new Error(listErr.message);
    if (!files || files.length === 0) throw new Error("אין קבצים בגיבוי");

    const zip = new JSZip();
    for (const f of files) {
      if (!f.name || f.name.endsWith(".zip")) continue;
      const { data: blob, error } = await supabaseAdmin.storage
        .from("backups")
        .download(`${data.folder}/${f.name}`);
      if (error) throw new Error(`${f.name}: ${error.message}`);
      zip.file(f.name, await blob.arrayBuffer());
    }
    const zipBuf = await zip.generateAsync({ type: "uint8array" });
    const zipPath = `${data.folder}/backup-${data.folder}.zip`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("backups")
      .upload(zipPath, zipBuf, { contentType: "application/zip", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("backups")
      .createSignedUrl(zipPath, 60 * 10);
    if (signErr) throw new Error(signErr.message);
    return { url: signed.signedUrl };
  });

// Restore is destructive — requires super_admin and a confirmation token
// minted by the UI's double-confirm dialog. The audit log is written both
// before the restore (intent) and after (result) for full traceability.
export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { files: { table: string; csv: string }[]; mode?: "merge" | "replace"; confirm_token?: string }) =>
    z.object({
      files: z.array(z.object({
        table: z.enum(["systems","system_notes","system_activity_log","system_transfers","profiles","user_roles","status_settings"]),
        csv: z.string().min(1).max(20_000_000),
      })).min(1).max(20),
      mode: z.enum(["merge","replace"]).optional(),
      // Must be the literal word "שחזר" — typed by the user in the
      // confirmation dialog. Prevents accidental restores via stale tabs
      // or replayed requests.
      confirm_token: z.literal("שחזר"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pre-restore audit entry — captures intent even if the restore crashes.
    const { data: prof } = await supabaseAdmin
      .from("profiles").select("display_name").eq("id", context.userId).maybeSingle();
    const actorName = (prof as any)?.display_name ?? null;
    const summary = data.files.map((f) => `${f.table} (${f.csv.length}B)`).join(", ");
    const mode = data.mode ?? "merge";

    try {
      await supabaseAdmin.from("system_activity_log").insert({
        system_id: null,
        actor_id: context.userId,
        actor_display_name: actorName,
        action: "backup_restore_started",
        field: `mode:${mode}`,
        old_value: null,
        new_value: summary,
      });
    } catch (e) {
      console.error("[backups.restore] failed to write pre-restore audit entry", e);
    }

    const { runRestore } = await import("@/lib/backups.server");
    let result: Awaited<ReturnType<typeof runRestore>>;
    try {
      result = await runRestore(data.files, mode);
    } catch (e: any) {
      try {
        await supabaseAdmin.from("system_activity_log").insert({
          system_id: null,
          actor_id: context.userId,
          actor_display_name: actorName,
          action: "backup_restore_failed",
          field: `mode:${mode}`,
          old_value: summary,
          new_value: e?.message ?? String(e),
        });
      } catch (logErr) {
        console.error("[backups.restore] failed to write failure audit entry", logErr);
      }
      throw e;
    }

    // Post-restore audit entry — full result summary.
    try {
      const resultSummary = result.map((r) => `${r.table}:${r.inserted}${r.error ? `(err:${r.error})` : ""}`).join(", ");
      await supabaseAdmin.from("system_activity_log").insert({
        system_id: null,
        actor_id: context.userId,
        actor_display_name: actorName,
        action: "backup_restore_completed",
        field: `mode:${mode}`,
        old_value: summary,
        new_value: resultSummary,
      });
    } catch (e) {
      console.error("[backups.restore] failed to write completion audit entry", e);
    }

    return result;
  });
