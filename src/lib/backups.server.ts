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

// Upsert rows in batches; if the batch fails, fall back to row-by-row so a
// single bad row doesn't block the rest. Collects per-row error messages.
async function upsertResilient(table: string, rows: any[]): Promise<{ inserted: number; skipped: number; details: string[] }> {
  let inserted = 0;
  let skipped = 0;
  const details: string[] = [];
  const batch = 200;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const { error, count } = await (supabaseAdmin as any).from(table)
      .upsert(slice, { onConflict: "id", ignoreDuplicates: false, count: "exact" });
    if (!error) { inserted += count ?? slice.length; continue; }
    // Fall back to per-row to identify and skip only the bad ones.
    for (const row of slice) {
      const { error: rowErr } = await (supabaseAdmin as any).from(table)
        .upsert([row], { onConflict: "id", ignoreDuplicates: false });
      if (rowErr) {
        skipped++;
        if (details.length < 10) details.push(`${row.id ?? "?"}: ${rowErr.message}`);
      } else {
        inserted++;
      }
    }
  }
  return { inserted, skipped, details };
}

export async function runRestore(files: RestoreInput, mode: "merge" | "replace" = "merge"): Promise<RestoreResult> {
  const order = ["profiles", "user_roles", "status_settings", "systems", "system_notes", "system_transfers", "system_activity_log"];
  const sorted = [...files].sort((a, b) => order.indexOf(a.table) - order.indexOf(b.table));
  const results: RestoreResult = [];

  for (const f of sorted) {
    try {
      const rows = parseCSV(f.csv);
      if (mode === "replace") {
        await (supabaseAdmin as any).from(f.table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      }

      // `systems` has a self-FK on parent_system_id. Insert all rows with the
      // parent reference nulled out, then patch parent_system_id in a second
      // pass so order between parent/child rows doesn't matter.
      if (f.table === "systems") {
        const parentMap = new Map<string, string | null>();
        const flat = rows.map((r) => {
          if (r.parent_system_id) parentMap.set(r.id, r.parent_system_id);
          return { ...r, parent_system_id: null };
        });
        const pass1 = await upsertResilient("systems", flat);
        // Second pass — restore parent_system_id values.
        let patched = 0;
        const patchDetails: string[] = [];
        for (const [id, parentId] of parentMap.entries()) {
          const { error } = await (supabaseAdmin as any).from("systems")
            .update({ parent_system_id: parentId }).eq("id", id);
          if (error) {
            if (patchDetails.length < 5) patchDetails.push(`${id} parent: ${error.message}`);
          } else patched++;
        }
        results.push({
          table: "systems",
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
