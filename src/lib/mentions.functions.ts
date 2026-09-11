import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";
import { sanitizeText } from "@/lib/sanitize";

// Pure helper (also covered by tests): builds the exact args object the
// add_note_with_mentions RPC receives, so the handler and its test agree on
// the shape — ids (not display names) and the mentionAll flag pass through
// untouched.
export function buildMentionRpcArgs(input: {
  sourceType: "system_note" | "crm_record_note";
  targetId: string;
  crmKey: string;
  body: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: string[];
  mentionAll: boolean;
}) {
  return {
    _source_type: input.sourceType,
    _target_id: input.targetId,
    _crm_key: input.crmKey,
    _body: input.body,
    _author: input.authorId,
    _author_name: input.authorName,
    _mentioned_user_ids: input.mentionedUserIds,
    _mention_all: input.mentionAll,
  };
}

export function buildUpdateMentionRpcArgs(input: {
  sourceType: "system_note" | "crm_record_note";
  noteId: string;
  body: string;
  editorId: string;
  mentionedUserIds: string[];
  mentionAll: boolean;
}) {
  return {
    _source_type: input.sourceType,
    _note_id: input.noteId,
    _body: input.body,
    _editor: input.editorId,
    _mentioned_user_ids: input.mentionedUserIds,
    _mention_all: input.mentionAll,
  };
}

async function armMentionQueueJob(supabaseAdmin: any) {
  try {
    const { error } = await supabaseAdmin.rpc("ensure_mention_queue_job");
    if (error) {
      const { logger } = await import("@/lib/logger.server");
      logger.info("[mentions] arming queue job failed", { message: error.message });
    }
  } catch (e: any) {
    const { logger } = await import("@/lib/logger.server");
    logger.info("[mentions] arming queue job failed", { message: e?.message ?? e });
  }
}

async function assertNotesWriteAuthorization(
  userId: string,
  sourceType: "system_note" | "crm_record_note",
  crmKey: string,
) {
  if (sourceType === "system_note") {
    if (crmKey !== "yemot") throw new Error("קוד CRM לא תואם להערת מערכת");
    const { assertCanWrite, assertPermission } = await import("@/lib/permissions.server");
    await assertCanWrite(userId, "yemot");
    await assertPermission(userId, "notes_write", "yemot");
  } else {
    const { assertPermission } = await import("@/lib/permissions.server");
    await assertPermission(userId, "notes_write", crmKey);
  }
}

async function authorDisplayName(supabaseAdmin: any, userId: string): Promise<string> {
  const { data } = await supabaseAdmin.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return (data as any)?.display_name ?? "";
}

const mentionedUserIdsSchema = z.array(z.string().uuid()).max(50);

export const addNoteWithMentions = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: {
    sourceType: "system_note" | "crm_record_note";
    targetId: string;
    crmKey: string;
    body: string;
    mentionedUserIds: string[];
    mentionAll: boolean;
  }) =>
    z.object({
      sourceType: z.enum(["system_note", "crm_record_note"]),
      targetId: z.string().uuid(),
      crmKey: z.string().min(1).max(40),
      body: z.string().min(1).max(5000),
      mentionedUserIds: mentionedUserIdsSchema,
      mentionAll: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertNotesWriteAuthorization(context.userId, data.sourceType, data.crmKey);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const authorName = await authorDisplayName(supabaseAdmin, context.userId);
    const args = buildMentionRpcArgs({
      sourceType: data.sourceType,
      targetId: data.targetId,
      crmKey: data.crmKey,
      body: sanitizeText(data.body),
      authorId: context.userId,
      authorName,
      mentionedUserIds: data.mentionedUserIds,
      mentionAll: data.mentionAll,
    });
    const { data: result, error } = await supabaseAdmin.rpc("add_note_with_mentions", args);
    if (error) throw new Error(error.message);
    const parsed = result as { note_id: string; recipients: string[] };

    void (async () => {
      try {
        const { processMentionQueue } = await import("@/lib/mentions.server");
        await processMentionQueue(supabaseAdmin);
      } catch {
        // best-effort only — the queue job below picks up anything missed.
      }
    })();
    void armMentionQueueJob(supabaseAdmin);

    return { noteId: parsed.note_id, recipients: parsed.recipients ?? [] };
  });

export const updateNoteWithMentions = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: {
    sourceType: "system_note" | "crm_record_note";
    noteId: string;
    body: string;
    mentionedUserIds: string[];
    mentionAll: boolean;
  }) =>
    z.object({
      sourceType: z.enum(["system_note", "crm_record_note"]),
      noteId: z.string().uuid(),
      body: z.string().min(1).max(5000),
      mentionedUserIds: mentionedUserIdsSchema,
      mentionAll: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.sourceType === "system_note") {
      const { hasPermission, assertCanWrite } = await import("@/lib/permissions.server");
      await assertCanWrite(context.userId, "yemot");
      const { data: existing, error: fetchErr } = await supabaseAdmin
        .from("system_notes").select("author_id").eq("id", data.noteId).maybeSingle();
      if (fetchErr) throw new Error(fetchErr.message);
      if (!existing) throw new Error("ההערה לא נמצאה");
      const isAuthor = (existing as any).author_id === context.userId;
      const canEditAll = await hasPermission(context.userId, "history_edit", "yemot");
      if (!isAuthor && !canEditAll) throw new Error("אין הרשאה לערוך הערה של משתמש אחר");
    } else {
      const { hasPermission } = await import("@/lib/permissions.server");
      const { data: note, error: fetchErr } = await supabaseAdmin
        .from("crm_record_notes").select("crm_key, author_id").eq("id", data.noteId).maybeSingle();
      if (fetchErr) throw new Error(fetchErr.message);
      if (!note) throw new Error("הערה לא נמצאה");
      const isAuthor = (note as any).author_id === context.userId;
      const canEditAll = await hasPermission(context.userId, "history_edit", (note as any).crm_key);
      if (!isAuthor && !canEditAll) throw new Error("אין הרשאה לערוך הערה");
    }

    const args = buildUpdateMentionRpcArgs({
      sourceType: data.sourceType,
      noteId: data.noteId,
      body: sanitizeText(data.body),
      editorId: context.userId,
      mentionedUserIds: data.mentionedUserIds,
      mentionAll: data.mentionAll,
    });
    const { data: result, error } = await supabaseAdmin.rpc("update_note_with_mentions", args);
    if (error) throw new Error(error.message);
    const parsed = result as { note_id: string; recipients: string[] };

    void (async () => {
      try {
        const { processMentionQueue } = await import("@/lib/mentions.server");
        await processMentionQueue(supabaseAdmin);
      } catch {
        // best-effort only
      }
    })();
    void armMentionQueueJob(supabaseAdmin);

    return { noteId: parsed.note_id, recipients: parsed.recipients ?? [] };
  });
