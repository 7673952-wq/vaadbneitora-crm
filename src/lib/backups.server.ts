import { supabaseAdmin } from "@/integrations/supabase/client.server";

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
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
    const { data, error } = await supabaseAdmin.from(table).select("*").range(from, from + pageSize - 1);
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
  const tables = ["systems", "system_notes", "system_activity_log", "system_transfers", "profiles", "user_roles", "status_settings"];
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
  }

  return { folder, files };
}
