import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as XLSX from "xlsx";
import { STATUS_LABEL } from "@/lib/status";

// ---------- Scheduled-backup time matching ----------
// The DB-side pg_cron job fires a lightweight "heartbeat" every 15 minutes
// (see supabase/migrations/*_scheduled_backup_schedule.sql). Each heartbeat
// calls shouldRunScheduledBackup() to decide, based on the admin-configured
// backup_schedule setting (ניהול → גיבויים), whether *this* is the moment to
// actually run+email a backup. Comparing in Asia/Jerusalem local time means
// admins pick an hour the way they'd say it out loud, without worrying about
// UTC or DST.
type BackupScheduleSetting = { frequency: "daily" | "weekly"; hour: number; dayOfWeek: number };

function jerusalemParts(date: Date): { hour: number; dayOfWeek: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit", hour12: false,
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // "24" from hour12:false at midnight is a known Intl quirk — normalize to 0.
  const hour = Number(parts.hour) % 24;
  return {
    hour,
    dayOfWeek: weekdayMap[parts.weekday] ?? new Date(date).getDay(),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// Exported for the webhook + for tests: decides whether a scheduled backup
// should run right now, and returns the matched kind for the email subject.
export function shouldRunScheduledBackup(
  schedule: BackupScheduleSetting,
  lastRunAt: string | null,
  now: Date = new Date(),
): { run: boolean; kind: "daily" | "weekly" } {
  const { hour, dayOfWeek, dateKey } = jerusalemParts(now);
  const kind: "daily" | "weekly" = schedule.frequency === "weekly" ? "weekly" : "daily";
  if (hour !== schedule.hour) return { run: false, kind };
  if (kind === "weekly" && dayOfWeek !== schedule.dayOfWeek) return { run: false, kind };
  // Guard against running twice within the same target hour (the heartbeat
  // fires every 15 min, so the hour condition above matches 4 times in a
  // row) — only run if we haven't already run today (or, for weekly, we
  // haven't already run on this exact calendar day).
  const lastRunDateKey = lastRunAt ? jerusalemParts(new Date(lastRunAt)).dateKey : null;
  if (lastRunDateKey === dateKey) return { run: false, kind };
  return { run: true, kind };
}

import { sanitizeCell, sanitizeRows } from "./csv-safe";

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const safe = sanitizeCell(typeof v === "object" ? JSON.stringify(v) : v);
  const s = String(safe);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(rows: any[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r ?? {}).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n");
}

async function fetchAll(table: string) {
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await (supabaseAdmin as any).from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export type BackupResult = {
  folder: string;
  files: { name: string; path: string; rows: number }[];
};

export async function runBackup(): Promise<BackupResult> {
  // Every table in the schema must be listed here, or a restore from backup
  // will silently lose that data. Keep this in sync with the Database type
  // in src/integrations/supabase/types.ts.
  const tables = [
    "systems", "system_notes", "system_activity_log", "system_transfers", "system_files",
    "profiles", "user_roles", "role_permissions", "user_permissions",
    "status_settings", "app_settings", "voice_message_log",
    "email_messages", "email_threads", "email_templates",
    // Multi-CRM data — the general backup covers every CRM, not just Yemot.
    "crms", "crm_field_defs", "crm_user_roles", "crm_settings",
    "crm_records", "crm_record_notes", "crm_record_activity",
    "kosher_instructions", "notification_role_defaults", "notification_user_overrides",
  ];
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = ts;
  const files: BackupResult["files"] = [];

  for (const t of tables) {
    const rows = await fetchAll(t);
    const csv = toCSV(rows);
    const path = `${folder}/${t}.csv`;
    const { error } = await supabaseAdmin.storage.from("backups").upload(path, new Blob([csv], { type: "text/csv" }), {
      contentType: "text/csv",
      upsert: true,
    });
    if (error) throw new Error(`upload ${t}: ${error.message}`);
    files.push({ name: `${t}.csv`, path, rows: rows.length });

    // Alongside the raw systems.csv, also build a friendlier Excel summary
    // with just the columns managers actually want to skim: number, name,
    // status (label, not the internal key), caller phone, and notes.
    if (t === "systems") {
      const sheetRows = rows.map((r: any) => ({
        "מספר": r.system_code ?? "",
        "שם": r.name ?? "",
        "סטטוס": STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status ?? "",
        "מספר פונה": r.caller_phone ?? "",
        "הערות": r.notes ?? "",
      }));
      const worksheet = XLSX.utils.json_to_sheet(sanitizeRows(sheetRows));
      worksheet["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 40 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "מערכות");
      const xlsxBuf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const xlsxPath = `${folder}/systems.xlsx`;
      const { error: xlsxErr } = await supabaseAdmin.storage.from("backups").upload(
        xlsxPath,
        new Blob([new Uint8Array(xlsxBuf)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true },
      );
      if (xlsxErr) throw new Error(`upload systems.xlsx: ${xlsxErr.message}`);
      files.push({ name: "systems.xlsx", path: xlsxPath, rows: sheetRows.length });
    }
  }

  return { folder, files };
}

// Emails a completed backup as a ZIP attachment. Shared by both the daily
// and weekly cron webhooks so every scheduled backup — not just the
// Thursday one — actually reaches the configured inbox. Recipient is read
// from app_settings.backup_email, falling back to WEEKLY_REPORT_EMAIL.
// Prefers the Gmail relay (Apps Script, ניהול → מיילים) when it's
// configured — sends from the same shared mailbox agents already use, no
// separate transactional-email account needed. Falls back to Resend
// (RESEND_API_KEY) if the relay isn't set up. Returns a short status
// string for logging; never throws.
export async function sendBackupEmail(result: BackupResult, kind: "daily" | "weekly" | "manual"): Promise<string> {
  const { data: setting } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "backup_email").maybeSingle();
  const v = (setting?.value as { email?: string; emails?: string[] } | null) ?? null;
  const recipients = (Array.isArray(v?.emails) && v.emails.length ? v.emails : (v?.email ? [v.email] : []))
    .map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0 && process.env.WEEKLY_REPORT_EMAIL) recipients.push(process.env.WEEKLY_REPORT_EMAIL.trim());
  if (recipients.length === 0) return "skipped (no recipient configured)";
  const recipient = recipients.join(", ");

  let zipBuf: Uint8Array;
  let filename: string;
  const subjectLabel = kind === "weekly" ? "שבועי" : kind === "daily" ? "יומי" : "ידני";
  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const f of result.files) {
      const { data: blob, error } = await supabaseAdmin.storage.from("backups").download(f.path);
      if (error) throw new Error(`${f.name}: ${error.message}`);
      zip.file(f.name, await blob.arrayBuffer());
    }
    zipBuf = await zip.generateAsync({ type: "uint8array" });
    filename = `backup-${result.folder}.zip`;
  } catch (e: any) {
    return `error building zip:${e?.message ?? "unknown"}`;
  }

  // Try the Gmail relay first, if configured.
  const [{ data: relayUrlRow }, { data: relaySecretRow }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_url").maybeSingle(),
    supabaseAdmin.from("app_settings").select("value").eq("key", "email_relay_secret").maybeSingle(),
  ]);
  const relayUrl = (relayUrlRow?.value as { url?: string } | null)?.url;
  const relaySecret = (relaySecretRow?.value as { secret?: string } | null)?.secret;
  if (relayUrl && relaySecret) {
    try {
      const resp = await fetch(relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: relaySecret,
          action: "send_backup",
          to: recipient,
          subject: `גיבוי CRM ${subjectLabel} — ${result.folder}`,
          body: `מצורף קובץ הגיבוי ה${subjectLabel} של ה-CRM (${filename}). גודל: ${(zipBuf.length / 1024).toFixed(0)} KB.`,
          attachmentBase64: Buffer.from(zipBuf).toString("base64"),
          attachmentName: filename,
        }),
      });
      const raw = await resp.text().catch(() => "");
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* not json */ }
      if (resp.ok && json?.ok) return "sent (gmail relay)";
      if (resp.status === 404) {
        return "failed (gmail relay):404: כתובת ה-Web App לא נמצאה — צריך Deploy חדש ב-Apps Script ולהעתיק את כתובת ה-/exec לניהול → מיילים";
      }
      if (!json) {
        return `failed (gmail relay):${resp.status}: הממסר החזיר תשובה שאינה JSON (כנראה נדרש Who has access: Anyone)`;
      }
      return `failed (gmail relay):${resp.status}:${json?.error ?? ""}`.slice(0, 250);

    } catch (e: any) {
      return `error (gmail relay):${e?.message ?? "unknown"}`;
    }
  }

  // Fall back to Resend.
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return "skipped (no email relay or RESEND_API_KEY configured)";
  try {
    const base64 = Buffer.from(zipBuf).toString("base64");
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "CRM Backups <onboarding@resend.dev>",
        to: [recipient],
        subject: `גיבוי CRM ${subjectLabel} — ${result.folder}`,
        text: `מצורף קובץ הגיבוי ה${subjectLabel} של ה-CRM (${filename}). גודל: ${(zipBuf.length / 1024).toFixed(0)} KB.`,
        attachments: [{ filename, content: base64 }],
      }),
    });
    return resp.ok ? "sent (resend)" : `failed (resend):${resp.status}:${(await resp.text().catch(() => "")).slice(0, 200)}`;
  } catch (e: any) {
    return `error (resend):${e?.message ?? "unknown"}`;
  }
}

// ---------- Restore from backup ----------

function parseCSV(text: string): Record<string, any>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const headers = rows[0];
  const out: Record<string, any>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === "") continue;
    const obj: Record<string, any> = {};
    headers.forEach((h, idx) => {
      let v: any = r[idx] ?? "";
      if (v === "") v = null;
      else if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
      else if (/^[\[{]/.test(v)) {
        try { v = JSON.parse(v); } catch (err) {
          console.error("[backups.restore] failed to parse JSON field; keeping raw string", { field: h, error: err });
        }
      }
      obj[h] = v;
    });
    out.push(obj);
  }
  return out;
}

export type RestoreInput = { table: string; csv: string }[];
export type RestoreResult = { table: string; inserted: number; skipped: number; error?: string; details?: string[] }[];

// Primary-key column(s) per backup table — most are `id`, but a few use a
// different single column or a composite key. Used as the upsert conflict
// target (Postgrest/supabase-js accepts a comma-separated column list for
// composite keys).
const PK_COLUMN: Record<string, string> = {
  status_settings: "status_key",
  app_settings: "key",
  role_permissions: "crm_key,role,permission",
  user_permissions: "crm_key,user_id,permission",
  crms: "key",
  crm_settings: "crm_key,key",
  notification_role_defaults: "role,event_key",
  notification_user_overrides: "user_id,event_key",
};
const pkOf = (t: string) => PK_COLUMN[t] ?? "id";

// Upsert rows in batches; if the batch fails, fall back to row-by-row so a
// single bad row doesn't block the rest. Collects per-row error messages.
async function upsertResilient(table: string, rows: any[]): Promise<{ inserted: number; skipped: number; details: string[] }> {
  let inserted = 0;
  let skipped = 0;
  const details: string[] = [];
  const onConflict = pkOf(table);
  const batch = 200;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const { error, count } = await (supabaseAdmin as any).from(table)
      .upsert(slice, { onConflict, ignoreDuplicates: false, count: "exact" });
    if (!error) { inserted += count ?? slice.length; continue; }
    // Fall back to per-row to identify and skip only the bad ones.
    for (const row of slice) {
      const { error: rowErr } = await (supabaseAdmin as any).from(table)
        .upsert([row], { onConflict, ignoreDuplicates: false });
      if (rowErr) {
        skipped++;
        const key = onConflict.split(",").map((c) => row[c] ?? "?").join("/");
        if (details.length < 10) details.push(`${key}: ${rowErr.message}`);
      } else {
        inserted++;
      }
    }
  }
  return { inserted, skipped, details };
}

export async function runRestore(files: RestoreInput, mode: "merge" | "replace" = "merge"): Promise<RestoreResult> {
  const order = [
    "profiles", "user_roles", "role_permissions", "user_permissions",
    "status_settings", "app_settings", "systems", "system_files",
    "system_notes", "system_transfers", "system_activity_log",
    "crms", "crm_field_defs", "crm_user_roles", "crm_settings",
    "crm_records", "crm_record_notes", "crm_record_activity",
    "kosher_instructions", "notification_role_defaults", "notification_user_overrides",
  ];
  const sorted = [...files].sort((a, b) => order.indexOf(a.table) - order.indexOf(b.table));
  const results: RestoreResult = [];

  for (const f of sorted) {
    try {
      const rows = parseCSV(f.csv);
      if (mode === "replace") {
        // Delete every existing row before re-inserting. Use "IS NOT NULL" on
        // the table's own primary-key column (rather than a hardcoded `id`,
        // which several tables — status_settings, app_settings,
        // role_permissions, user_permissions — don't have) so this works for
        // every backup table regardless of its key's name or type.
        const pkCol = pkOf(f.table).split(",")[0];
        await (supabaseAdmin as any).from(f.table).delete().not(pkCol, "is", null);
      }

      // `systems` has a self-FK on parent_system_id. Insert all rows with the
      // parent reference nulled out, then patch parent_system_id in a second
      // pass so order between parent/child rows doesn't matter.
      const selfFk = f.table === "systems" ? "parent_system_id"
        : f.table === "crm_records" ? "parent_record_id" : null;
      if (selfFk) {
        const parentMap = new Map<string, string | null>();
        const flat = rows.map((r) => {
          if (r[selfFk]) parentMap.set(r.id, r[selfFk]);
          return { ...r, [selfFk]: null };
        });
        const pass1 = await upsertResilient(f.table, flat);
        // Second pass — restore parent_system_id values.
        let patched = 0;
        const patchDetails: string[] = [];
        for (const [id, parentId] of parentMap.entries()) {
          const { error } = await (supabaseAdmin as any).from(f.table)
            .update({ [selfFk]: parentId }).eq("id", id);
          if (error) {
            if (patchDetails.length < 5) patchDetails.push(`${id} parent: ${error.message}`);
          } else patched++;
        }
        results.push({
          table: f.table,
          inserted: pass1.inserted,
          skipped: pass1.skipped,
          details: [...pass1.details, ...patchDetails],
          ...(pass1.details.length || patchDetails.length ? { error: `דילג על ${pass1.skipped} שורות` } : {}),
        });
        continue;
      }

      const res = await upsertResilient(f.table, rows);
      results.push({
        table: f.table,
        inserted: res.inserted,
        skipped: res.skipped,
        details: res.details,
        ...(res.skipped ? { error: `דילג על ${res.skipped} שורות: ${res.details.slice(0, 3).join(" | ")}` } : {}),
      });
    } catch (e: any) {
      results.push({ table: f.table, inserted: 0, skipped: 0, error: e?.message ?? String(e) });
    }
  }
  return results;
}
