import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeText } from "@/lib/sanitize";

export const listSystemFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string }) =>
    z.object({ system_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("system_files")
      .select("id, file_name, mime_type, size_bytes, storage_path, uploaded_by, created_at")
      .eq("system_id", data.system_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const uploaderIds = Array.from(new Set((rows ?? []).map((r) => r.uploaded_by).filter(Boolean)));
    let names = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles").select("id, display_name").in("id", uploaderIds as string[]);
      (profs ?? []).forEach((p: any) => names.set(p.id, p.display_name));
    }
    return (rows ?? []).map((r) => ({
      ...r,
      uploader_name: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
    }));
  });

export const uploadSystemFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { system_id: string; file_name: string; mime_type: string; data_base64: string }) =>
    z.object({
      system_id: z.string().uuid(),
      file_name: z.string().min(1).max(255),
      mime_type: z.string().max(150).default(""),
      data_base64: z.string().min(1).max(20 * 1024 * 1024), // ~15MB binary cap
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertCanWrite } = await import("@/lib/permissions.server");
    await assertCanWrite(context.userId);
    // Verify caller can upload to this system
    const { data: sys, error: sysErr } = await context.supabase
      .from("systems").select("id, assigned_agent_id").eq("id", data.system_id).maybeSingle();
    if (sysErr || !sys) throw new Error("מערכת לא נמצאה");
    const { hasRole } = await import("@/lib/permissions.server");
    const isAdmin = await hasRole(context.userId, "admin");
    if (!isAdmin && sys.assigned_agent_id !== context.userId) {
      throw new Error("רק מנהל או הנציג המשויך יכולים להעלות קבצים");
    }
    // Allowlist: block active content (html/svg/scripts) that could be served
    // back to a browser from a signed URL.
    const ALLOWED_MIME = [
      "image/png", "image/jpeg", "image/gif", "image/webp", "image/heic",
      "application/pdf", "text/plain", "text/csv",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip", "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "video/mp4",
      "application/octet-stream", "",
    ];
    const mime = (data.mime_type || "").toLowerCase();
    if (!ALLOWED_MIME.includes(mime)) throw new Error("סוג הקובץ אינו נתמך");
    if (/\.(html?|svg|js|mjs|xhtml|php|exe|sh|bat)$/i.test(data.file_name)) {
      throw new Error("סוג הקובץ אינו נתמך");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const buffer = Buffer.from(data.data_base64, "base64");
    const safeName = data.file_name.replace(/[^A-Za-z0-9._\u0590-\u05FF\- ]/g, "_");
    const path = `${data.system_id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabaseAdmin.storage.from("system-files").upload(path, buffer, {
      contentType: data.mime_type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);
    const { error: dbErr } = await supabaseAdmin.from("system_files").insert({
      system_id: data.system_id,
      storage_path: path,
      file_name: sanitizeText(data.file_name),
      mime_type: data.mime_type || null,
      size_bytes: buffer.byteLength,
      uploaded_by: context.userId,
    });
    if (dbErr) {
      await supabaseAdmin.storage.from("system-files").remove([path]);
      throw new Error(dbErr.message);
    }
    return { ok: true };
  });

export const getSystemFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { file_id: string }) =>
    z.object({ file_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("system_files").select("storage_path").eq("id", data.file_id).maybeSingle();
    if (error || !row) throw new Error("הקובץ לא נמצא");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("system-files").createSignedUrl(row.storage_path, 60 * 10);
    if (sErr) throw new Error(sErr.message);
    return { url: signed.signedUrl };
  });

export const deleteSystemFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { file_id: string }) =>
    z.object({ file_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertCanWrite } = await import("@/lib/permissions.server");
    await assertCanWrite(context.userId);
    const { data: row, error } = await context.supabase
      .from("system_files").select("storage_path, uploaded_by").eq("id", data.file_id).maybeSingle();
    if (error || !row) throw new Error("הקובץ לא נמצא");
    const { hasRole } = await import("@/lib/permissions.server");
    const isAdmin = await hasRole(context.userId, "admin");
    if (!isAdmin && row.uploaded_by !== context.userId) {
      throw new Error("רק מנהל או המעלה יכול למחוק את הקובץ");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from("system-files").remove([row.storage_path]);
    const { error: dErr } = await supabaseAdmin.from("system_files").delete().eq("id", data.file_id);
    if (dErr) throw new Error(dErr.message);
    return { ok: true };
  });
