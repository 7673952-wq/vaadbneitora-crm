type SupabaseLike = {
  from: (table: string) => any;
};

export type StatusSettingRow = {
  status_key: string;
  label: string;
  tone: string;
  sort_order: number;
  is_custom: boolean;
  is_handled: boolean;
  is_mandatory: boolean;
  requires_reason: boolean;
  assigned_agent_ids: string[];
  enables_voice_message: boolean;
  voice_message_template: string;
  voice_message_api_key: string;
};

const STATUS_SETTINGS_CONFIG_KEY = "status_settings_config";
const DEFAULT_NO_REASON = new Set(["open", "closed", "open_only_bimot"]);
function isDefaultRequiresReason(key: string) {
  return !DEFAULT_NO_REASON.has(key);
}
const WORKFLOW_STATUS_KEYS = new Set([
  "block_from_root",
  "send_to_yosela",
  "sent_to_yosela",
  "blocked_from_root",
  "send_to_committee",
  "sent_to_committee",
  "blocked_in_committee",
]);

const DEFAULT_STATUS_SETTINGS = [
  ["pending_check_close", "לבדיקה לחסימה", "amber", 1, false],
  ["pending_check_open", "לבדיקה לפתיחה", "teal", 2, false],
  ["to_open", "לפתוח", "lightgreen", 3, false],
  ["to_block", "לחסום", "lightred", 4, false],
  ["block_from_root", "לחסום מהשורש", "brightred", 5, false],
  ["problem", "בעיה", "orange", 6, false],
  ["open", "פתוח", "green", 7, true],
  ["closed", "חסום", "red", 8, true],
  ["open_only_bimot", "לפתוח רק בימות", "sky", 9, true],
  ["close_only_bimot", "פתוח רק בימות", "indigo", 10, false],
  ["open_in_simahedrin", "לפתיחה בסימהדרין", "cyan", 11, false],
  ["close_in_simahedrin", "לחסימה בסימהדרין", "violet", 12, false],
  ["send_to_yosela", "לשלוח ליוסלה", "fuchsia", 13, false],
  ["sent_to_yosela", "נשלח ליוסלה", "pink", 14, true],
  ["blocked_from_root", "נחסם מהשורש", "darkred", 15, true],
  ["send_to_committee", "לשלוח לוועדה", "purple", 16, false],
  ["sent_to_committee", "נשלח לוועדה", "violet", 17, true],
  ["blocked_in_committee", "נחסם בוועדה", "black", 18, true],
] as const;

function isDefaultMandatory(key: string) {
  return !WORKFLOW_STATUS_KEYS.has(key);
}

function normalizeAgentIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export function defaultStatusRows(): StatusSettingRow[] {
  return DEFAULT_STATUS_SETTINGS.map(([status_key, label, tone, sort_order, is_handled]) => ({
    status_key,
    label,
    tone,
    sort_order,
    is_custom: false,
    is_handled,
    is_mandatory: isDefaultMandatory(status_key),
    requires_reason: isDefaultRequiresReason(status_key),
    assigned_agent_ids: [],
    enables_voice_message: false,
    voice_message_template: "",
    voice_message_api_key: "",
  }));
}

function normalizeRows(rows: unknown): StatusSettingRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row: any) => typeof row?.status_key === "string" && row.status_key.trim())
    .map((row: any, index) => {
      const statusKey = String(row.status_key).trim();
      return {
        status_key: statusKey,
        label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : statusKey,
        tone: typeof row.tone === "string" && row.tone.trim() ? row.tone.trim() : "green",
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index + 1,
        is_custom: row.is_custom === true,
        is_handled: row.is_handled === true,
        is_mandatory: typeof row.is_mandatory === "boolean" ? row.is_mandatory : isDefaultMandatory(statusKey),
        requires_reason: typeof row.requires_reason === "boolean" ? row.requires_reason : isDefaultRequiresReason(statusKey),
        assigned_agent_ids: normalizeAgentIds(row.assigned_agent_ids),
        enables_voice_message: row.enables_voice_message === true,
        voice_message_template: typeof row.voice_message_template === "string" ? row.voice_message_template : "",
        voice_message_api_key: typeof row.voice_message_api_key === "string" ? row.voice_message_api_key : "",
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

function configRows(value: unknown): StatusSettingRow[] {
  const raw = (value as any)?.rows ?? value;
  return normalizeRows(raw);
}

function isMissingMandatoryColumn(error: unknown) {
  const text = `${(error as any)?.code ?? ""} ${(error as any)?.message ?? ""} ${(error as any)?.details ?? ""}`;
  return text.includes("is_mandatory") || text.includes("schema cache") || text.includes("Could not find");
}

export async function readStatusSettings(supabase: SupabaseLike): Promise<StatusSettingRow[]> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", STATUS_SETTINGS_CONFIG_KEY)
      .maybeSingle();
    if (!error) {
      const rows = configRows((data as any)?.value);
      if (rows.length) return rows;
    }
  } catch {
    // Fall through to the legacy status table and then built-in defaults.
  }

  try {
    const full = await supabase
      .from("status_settings")
      .select("status_key, label, tone, sort_order, is_custom, is_handled, is_mandatory, assigned_agent_ids")
      .order("sort_order", { ascending: true });
    if (!full.error) {
      const rows = normalizeRows(full.data);
      if (rows.length) return rows;
    }

    if (isMissingMandatoryColumn(full.error)) {
      const basic = await supabase
        .from("status_settings")
        .select("status_key, label, tone, sort_order, is_custom, is_handled, assigned_agent_ids")
        .order("sort_order", { ascending: true });
      if (!basic.error) {
        const rows = normalizeRows(basic.data);
        if (rows.length) return rows;
      }
    }
  } catch {
    // Fall through to defaults.
  }

  return defaultStatusRows();
}

export async function writeStatusSettingsConfig(supabaseAdmin: SupabaseLike, rows: StatusSettingRow[], userId?: string | null) {
  const normalized = normalizeRows(rows);
  const { error } = await supabaseAdmin.from("app_settings").upsert({
    key: STATUS_SETTINGS_CONFIG_KEY,
    value: { rows: normalized },
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  });
  if (error) throw error;
  return normalized;
}

async function bestEffortMirrorStatusTable(supabaseAdmin: SupabaseLike, rows: StatusSettingRow[]) {
  // The mirror table does not have `requires_reason`, `enables_voice_message`,
  // `voice_message_template`, or `voice_message_api_key` columns — always strip
  // before writing. Source of truth is the app_settings JSON blob.
  const forTable = rows.map(({ requires_reason: _rr, enables_voice_message: _evm, voice_message_template: _vmt, voice_message_api_key: _vak, ...row }) => row);
  try {
    const { error } = await supabaseAdmin.from("status_settings").upsert(forTable, { onConflict: "status_key" } as any);
    if (!error) return;
    if (!isMissingMandatoryColumn(error)) return;

    const withoutMandatory = forTable.map(({ is_mandatory: _isMandatory, ...row }) => row);
    await supabaseAdmin.from("status_settings").upsert(withoutMandatory, { onConflict: "status_key" } as any);
  } catch {
    // The app_settings JSON copy is the source of truth; the table mirror is best-effort only.
  }
}


export async function upsertStatusSettingStable(supabaseAdmin: SupabaseLike, patch: Partial<StatusSettingRow> & { status_key: string }, userId: string) {
  const rows = await readStatusSettings(supabaseAdmin);
  const existingIndex = rows.findIndex((row) => row.status_key === patch.status_key);
  const existing = existingIndex >= 0
    ? rows[existingIndex]
    : {
        status_key: patch.status_key,
        label: patch.status_key,
        tone: "green",
        sort_order: Math.max(0, ...rows.map((row) => row.sort_order)) + 10,
        is_custom: true,
        is_handled: false,
        is_mandatory: isDefaultMandatory(patch.status_key),
        requires_reason: isDefaultRequiresReason(patch.status_key),
        assigned_agent_ids: [],
        enables_voice_message: false,
        voice_message_template: "",
        voice_message_api_key: "",
      };
  const [merged] = normalizeRows([{ ...existing, ...patch }]);
  if (!merged) return rows;
  const nextRows = [...rows];
  if (existingIndex >= 0) nextRows[existingIndex] = merged;
  else nextRows.push(merged);
  const saved = await writeStatusSettingsConfig(supabaseAdmin, nextRows, userId);
  await bestEffortMirrorStatusTable(supabaseAdmin, saved);
  return saved;
}

export async function reorderStatusSettingsStable(supabaseAdmin: SupabaseLike, order: string[], userId: string) {
  const orderMap = new Map(order.map((key, index) => [key, index]));
  const rows = (await readStatusSettings(supabaseAdmin)).sort((a, b) => {
    const ai = orderMap.has(a.status_key) ? orderMap.get(a.status_key)! : Number.MAX_SAFE_INTEGER;
    const bi = orderMap.has(b.status_key) ? orderMap.get(b.status_key)! : Number.MAX_SAFE_INTEGER;
    return ai - bi || a.sort_order - b.sort_order;
  }).map((row, index) => ({ ...row, sort_order: index + 1 }));
  const saved = await writeStatusSettingsConfig(supabaseAdmin, rows, userId);
  await bestEffortMirrorStatusTable(supabaseAdmin, saved);
  return saved;
}

export async function deleteStatusSettingStable(supabaseAdmin: SupabaseLike, statusKey: string, userId: string) {
  const rows = (await readStatusSettings(supabaseAdmin)).filter((row) => row.status_key !== statusKey);
  const saved = await writeStatusSettingsConfig(supabaseAdmin, rows, userId);
  try {
    await supabaseAdmin.from("status_settings").delete().eq("status_key", statusKey);
  } catch {
    // Best-effort only.
  }
  return saved;
}