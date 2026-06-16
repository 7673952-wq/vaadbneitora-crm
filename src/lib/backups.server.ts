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
      else if (/^[\[{]/.test(v)) { try { v = JSON.parse(v); } catch {} }
      obj[h] = v;
    });
    out.push(obj);
  }
  return out;
}

export type RestoreInput = { table: string; csv: string }[];
export type RestoreResult = { table: string; inserted: number; skipped: number; error?: string }[];

export async function runRestore(files: RestoreInput, mode: "merge" | "replace" = "merge"): Promise<RestoreResult> {
  // Process in dependency-safe order
  const order = ["profiles", "user_roles", "status_settings", "systems", "system_notes", "system_transfers", "system_activity_log"];
  const sorted = [...files].sort((a, b) => order.indexOf(a.table) - order.indexOf(b.table));
  const results: RestoreResult = [];

  for (const f of sorted) {
    try {
      const rows = parseCSV(f.csv);
      if (mode === "replace") {
        await (supabaseAdmin as any).from(f.table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      }
      let inserted = 0; let skipped = 0;
      const batch = 500;
      for (let i = 0; i < rows.length; i += batch) {
        const slice = rows.slice(i, i + batch);
        const { error, count } = await (supabaseAdmin as any).from(f.table)
          .upsert(slice, { onConflict: "id", ignoreDuplicates: false, count: "exact" });
        if (error) { skipped += slice.length; results.push({ table: f.table, inserted, skipped, error: error.message }); throw new Error(error.message); }
        else inserted += count ?? slice.length;
      }
      results.push({ table: f.table, inserted, skipped });
    } catch (e: any) {
      const existing = results.find((r) => r.table === f.table);
      if (!existing) results.push({ table: f.table, inserted: 0, skipped: 0, error: e?.message ?? String(e) });
    }
  }
  return results;
}
