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

// The client-supplied `crmKey` is never trusted for authorization on
// crm_record_note: the real CRM is derived from the record itself, so a
// caller cannot pass a CRM key they have access to while targeting a record
// that actually belongs to a different (unauthorized) CRM.
export async function resolveRealCrmKeyForRecord(
  supabaseAdmin: any,
  recordId: string,
  clientCrmKey: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("crm_records")
    .select("crm_key")
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("הרשומה לא נמצאה");
  const realCrmKey = (data as any).crm_key as string;
  if (realCrmKey !== clientCrmKey) throw new Error("קוד CRM לא תואם לרשומה");
  return realCrmKey;
}

async function authorizeAddNote(
  supabaseAdmin: any,
  userId: string,
  sourceType: "system_note" | "crm_record_note",
  targetId: string,
  crmKey: string,
): Promise<string> {
  if (sourceType === "system_note") {
    await assertNotesWriteAuthorization(userId, sourceType, crmKey);
    return crmKey;
  }
  const realCrmKey = await resolveRealCrmKeyForRecord(supabaseAdmin, targetId, crmKey);
  const { assertPermission } = await import("@/lib/permissions.server");
  await assertPermission(userId, "notes_write", realCrmKey);
  return realCrmKey;
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const realCrmKey = await authorizeAddNote(supabaseAdmin, context.userId, data.sourceType, data.targetId, data.crmKey);
    const authorName = await authorDisplayName(supabaseAdmin, context.userId);
    const args = buildMentionRpcArgs({
      sourceType: data.sourceType,
      targetId: data.targetId,
      crmKey: realCrmKey,
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


// Statuses where we could not confirm the email was (not) already sent —
// retrying them silently risks a duplicate email, so the caller must pass
// explicit confirmation after seeing a clear warning.
const AMBIGUOUS_DELIVERY_STATUSES = new Set(["unknown", "skipped_no_email"]);

export const MENTION_RETRY_CONFIRM_MESSAGE =
  "לא ניתן לאשר בוודאות אם המייל כבר נשלח למשתמש זה. יש לאשר במפורש שליחה חוזרת — ייתכן שהמייל כבר נשלח בעבר.";

// Pure guard (unit-tested): throws unless a plain retry is safe, i.e. the
// delivery is in a definitively failed state, or the caller explicitly
// confirmed a retry of an ambiguous ("unknown"/"skipped_no_email") one.
export function assertMentionRetryAllowed(status: string | undefined, confirmUnknown: boolean | undefined): void {
  if (AMBIGUOUS_DELIVERY_STATUSES.has(status ?? "") && !confirmUnknown) {
    throw new Error(MENTION_RETRY_CONFIRM_MESSAGE);
  }
}

// Explicit, audited retry of a mention email delivery: checks permission +
// rate limit (as before), then requires confirmation for ambiguous
// statuses, then requeues via the existing RPC (which persists
// retry_requested_by / retry_requested_at).
export async function performMentionRetry(
  supabaseAdmin: any,
  input: { deliveryId: string; userId: string; confirmUnknown?: boolean },
): Promise<{ ok: true }> {
  const { assertPermission } = await import("@/lib/permissions.server");
  await assertPermission(input.userId, "settings_manage", "yemot");

  const { limitSensitiveAction } = await import("@/lib/db-rate-limit.server");
  await limitSensitiveAction("mention_requeue", input.userId);

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("mention_email_deliveries")
    .select("status")
    .eq("id", input.deliveryId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  const status = (row as any)?.status as string | undefined;

  assertMentionRetryAllowed(status, input.confirmUnknown);

  const { data: ok, error } = await supabaseAdmin.rpc("requeue_mention_delivery", {
    _delivery_id: input.deliveryId,
    _actor: input.userId,
  });
  if (error) throw new Error(error.message);
  if (!ok) throw new Error("לא ניתן היה לשלוח מחדש את ההודעה");

  try {
    await supabaseAdmin.rpc("ensure_mention_queue_job");
  } catch {
    // best-effort only — arming
  }

  return { ok: true };
}

export const retryMentionDelivery = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: { deliveryId: string; confirmUnknown?: boolean }) =>
    z.object({
      deliveryId: z.string().uuid(),
      confirmUnknown: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return performMentionRetry(supabaseAdmin, {
      deliveryId: data.deliveryId,
      userId: context.userId,
      confirmUnknown: data.confirmUnknown,
    });
  });
