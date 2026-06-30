// Status definitions. Defaults live here; admins can override label/tone/order
// (and add custom statuses) at runtime via the status_settings table. The
// exported arrays/objects below are MUTATED in place by `applyStatusSettings`
// so existing consumers (which read `STATUS_LABEL[k]` / iterate `STATUS_OPTIONS`)
// see the latest values on next render. Trigger a re-render by invalidating
// affected queries after admin saves.

export type StatusOption = { value: string; label: string; tone: string; is_handled?: boolean; assigned_agent_ids?: string[] };

const DEFAULT_HANDLED = new Set(["open", "closed", "open_only_bimot", "sent_to_yosela", "blocked_from_root", "sent_to_committee", "blocked_in_committee"]);
// Status changes that DON'T require a "reason" prompt.
export const NO_REASON_STATUSES = new Set(["open", "closed", "open_only_bimot"]);

const DEFAULT_STATUS_OPTIONS: StatusOption[] = [
  { value: "pending_check_close", label: "לבדיקה לחסימה", tone: "amber" },
  { value: "pending_check_open", label: "לבדיקה לפתיחה", tone: "teal" },
  { value: "open", label: "פתוח", tone: "green" },
  { value: "to_open", label: "לפתוח", tone: "lightgreen" },
  { value: "closed", label: "חסום", tone: "red" },
  { value: "to_block", label: "לחסום", tone: "lightred" },
  { value: "block_from_root", label: "לחסום מהשורש", tone: "brightred" },
  { value: "problem", label: "בעיה", tone: "orange" },
  { value: "open_only_bimot", label: "לפתוח רק בימות", tone: "sky" },
  { value: "close_only_bimot", label: "פתוח רק בימות", tone: "indigo" },
  { value: "open_in_simahedrin", label: "לפתיחה בסימהדרין", tone: "cyan" },
  { value: "close_in_simahedrin", label: "לחסימה בסימהדרין", tone: "violet" },
  { value: "send_to_yosela", label: "לשלוח ליוסלה", tone: "fuchsia" },
  { value: "sent_to_yosela", label: "נשלח ליוסלה", tone: "pink" },
  { value: "blocked_from_root", label: "נחסם מהשורש", tone: "darkred" },
  { value: "send_to_committee", label: "לשלוח לוועדה", tone: "purple" },
  { value: "sent_to_committee", label: "נשלח לוועדה", tone: "violet" },
  { value: "blocked_in_committee", label: "נחסם בוועדה", tone: "black" },
].map((s) => ({ ...s, is_handled: DEFAULT_HANDLED.has(s.value), assigned_agent_ids: [] as string[] }));

export const SPECIAL_WORKFLOW_STATUS_KEYS = [
  "send_to_yosela",
  "sent_to_yosela",
  "blocked_from_root",
  "send_to_committee",
  "sent_to_committee",
  "blocked_in_committee",
] as const;

export function isSpecialWorkflowStatus(status: string): boolean {
  return (SPECIAL_WORKFLOW_STATUS_KEYS as readonly string[]).includes(status);
}

// Mutable runtime arrays/maps. Imported by reference everywhere.
export const STATUS_OPTIONS: StatusOption[] = [...DEFAULT_STATUS_OPTIONS];
export const STATUS_LABEL: Record<string, string> = {};
export const STATUS_TONE: Record<string, string> = {};
export const STATUS_HANDLED: Record<string, boolean> = {};
export const STATUS_AGENTS: Record<string, string[]> = {};
function rebuildMaps() {
  for (const k of Object.keys(STATUS_LABEL)) delete STATUS_LABEL[k];
  for (const k of Object.keys(STATUS_TONE)) delete STATUS_TONE[k];
  for (const k of Object.keys(STATUS_HANDLED)) delete STATUS_HANDLED[k];
  for (const k of Object.keys(STATUS_AGENTS)) delete STATUS_AGENTS[k];
  for (const s of STATUS_OPTIONS) {
    STATUS_LABEL[s.value] = s.label;
    STATUS_TONE[s.value] = s.tone;
    STATUS_HANDLED[s.value] = !!s.is_handled;
    STATUS_AGENTS[s.value] = s.assigned_agent_ids ?? [];
  }
}
rebuildMaps();

export type SystemStatus = string;

export function applyStatusSettings(rows: { status_key: string; label: string; tone: string; sort_order?: number; is_handled?: boolean; assigned_agent_ids?: string[] | null }[]) {
  if (!rows?.length) return;
  const sorted = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  STATUS_OPTIONS.length = 0;
  for (const r of sorted) STATUS_OPTIONS.push({
    value: r.status_key,
    label: r.label,
    tone: r.tone,
    is_handled: r.is_handled ?? DEFAULT_HANDLED.has(r.status_key),
    assigned_agent_ids: r.assigned_agent_ids ?? [],
  });
  rebuildMaps();
}

// Pure variant of `applyStatusSettings`: takes status rows and returns fresh
// objects without touching any module-level state. Prefer this in new code
// (e.g. inside React Query selectors) so consumers can cache derived maps
// without relying on the legacy mutable exports above.
export type StatusMaps = {
  options: StatusOption[];
  label: Record<string, string>;
  tone: Record<string, string>;
  handled: Record<string, boolean>;
  agents: Record<string, string[]>;
};

export function buildStatusMaps(
  rows?: { status_key: string; label: string; tone: string; sort_order?: number; is_handled?: boolean; assigned_agent_ids?: string[] | null }[] | null,
): StatusMaps {
  const source: StatusOption[] = rows && rows.length
    ? [...rows]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((r) => ({
          value: r.status_key,
          label: r.label,
          tone: r.tone,
          is_handled: r.is_handled ?? DEFAULT_HANDLED.has(r.status_key),
          assigned_agent_ids: r.assigned_agent_ids ?? [],
        }))
    : DEFAULT_STATUS_OPTIONS.map((s) => ({ ...s }));

  const label: Record<string, string> = {};
  const tone: Record<string, string> = {};
  const handled: Record<string, boolean> = {};
  const agents: Record<string, string[]> = {};
  for (const s of source) {
    label[s.value] = s.label;
    tone[s.value] = s.tone;
    handled[s.value] = !!s.is_handled;
    agents[s.value] = s.assigned_agent_ids ?? [];
  }
  return { options: source, label, tone, handled, agents };
}

export const AVAILABLE_TONES = [
  // greens
  "green", "lightgreen", "emerald", "darkgreen", "mint",
  // reds
  "red", "lightred", "brightred", "darkred", "rose", "crimson",
  // yellows / oranges
  "amber", "yellow", "gold", "orange", "darkorange", "peach",
  // blues / teals
  "teal", "darkteal", "sky", "blue", "darkblue", "cyan", "navy",
  // purples / pinks
  "indigo", "violet", "purple", "fuchsia", "pink", "hotpink", "magenta",
  // neutrals / specials
  "slate", "gray", "stone", "brown", "black", "white",
] as const;

// Small badge/chip — keep contrast distinct
export function toneClasses(tone: string): string {
  switch (tone) {
    case "green":      return "bg-emerald-200 text-emerald-900 border border-emerald-400";
    case "lightgreen": return "bg-lime-200 text-lime-900 border border-lime-400";
    case "emerald":    return "bg-emerald-500 text-white border border-emerald-700";
    case "darkgreen":  return "bg-green-800 text-green-50 border border-green-950";
    case "mint":       return "bg-green-100 text-green-900 border border-green-300";
    case "red":        return "bg-red-300 text-red-950 border border-red-500";
    case "lightred":   return "bg-rose-200 text-rose-950 border border-rose-400";
    case "brightred":  return "bg-red-700 text-white border border-red-900";
    case "darkred":    return "bg-red-900 text-red-50 border border-red-950";
    case "rose":       return "bg-rose-400 text-rose-950 border border-rose-600";
    case "crimson":    return "bg-red-500 text-white border border-red-700";
    case "amber":      return "bg-amber-200 text-amber-950 border border-amber-400";
    case "yellow":     return "bg-yellow-200 text-yellow-950 border border-yellow-400";
    case "gold":       return "bg-yellow-400 text-yellow-950 border border-yellow-600";
    case "orange":     return "bg-orange-200 text-orange-950 border border-orange-400";
    case "darkorange": return "bg-orange-500 text-white border border-orange-700";
    case "peach":      return "bg-orange-100 text-orange-900 border border-orange-300";
    case "teal":       return "bg-teal-200 text-teal-950 border border-teal-500";
    case "darkteal":   return "bg-teal-700 text-teal-50 border border-teal-900";
    case "sky":        return "bg-sky-200 text-sky-950 border border-sky-400";
    case "blue":       return "bg-blue-300 text-blue-950 border border-blue-500";
    case "darkblue":   return "bg-blue-800 text-blue-50 border border-blue-950";
    case "cyan":       return "bg-cyan-200 text-cyan-950 border border-cyan-400";
    case "navy":       return "bg-slate-800 text-slate-50 border border-slate-950";
    case "indigo":     return "bg-indigo-300 text-indigo-950 border border-indigo-500";
    case "violet":     return "bg-violet-300 text-violet-950 border border-violet-500";
    case "purple":     return "bg-purple-500 text-white border border-purple-700";
    case "fuchsia":    return "bg-fuchsia-200 text-fuchsia-950 border border-fuchsia-400";
    case "pink":       return "bg-pink-200 text-pink-950 border border-pink-400";
    case "hotpink":    return "bg-pink-500 text-white border border-pink-700";
    case "magenta":    return "bg-fuchsia-500 text-white border border-fuchsia-700";
    case "slate":      return "bg-slate-200 text-slate-950 border border-slate-400";
    case "gray":       return "bg-gray-300 text-gray-950 border border-gray-500";
    case "stone":      return "bg-stone-200 text-stone-900 border border-stone-400";
    case "brown":      return "bg-amber-800 text-amber-50 border border-amber-950";
    case "black":      return "bg-neutral-900 text-neutral-50 border border-neutral-950";
    case "white":      return "bg-white text-neutral-900 border border-neutral-300";
    default:           return "bg-muted text-muted-foreground border border-border";
  }
}

// Full card background — very distinct between similar shades
export function cardToneClasses(tone: string): string {
  switch (tone) {
    case "green":      return "bg-emerald-100 border-emerald-500 hover:bg-emerald-200 text-emerald-950";
    case "lightgreen": return "bg-lime-50 border-lime-400 hover:bg-lime-100 text-lime-950";
    case "emerald":    return "bg-emerald-300 border-emerald-600 hover:bg-emerald-400 text-emerald-950";
    case "darkgreen":  return "bg-green-700 border-green-900 hover:bg-green-800 text-green-50";
    case "mint":       return "bg-green-50 border-green-300 hover:bg-green-100 text-green-950";
    case "red":        return "bg-red-200 border-red-500 hover:bg-red-300 text-red-950";
    case "lightred":   return "bg-rose-50 border-rose-400 hover:bg-rose-100 text-rose-950";
    case "brightred":  return "bg-red-600 border-red-800 text-white hover:bg-red-700";
    case "darkred":    return "bg-red-800 border-red-950 text-red-50 hover:bg-red-900";
    case "rose":       return "bg-rose-300 border-rose-500 hover:bg-rose-400 text-rose-950";
    case "crimson":    return "bg-red-400 border-red-600 hover:bg-red-500 text-white";
    case "amber":      return "bg-amber-50 border-amber-400 hover:bg-amber-100 text-amber-950";
    case "yellow":     return "bg-yellow-50 border-yellow-400 hover:bg-yellow-100 text-yellow-950";
    case "gold":       return "bg-yellow-300 border-yellow-600 hover:bg-yellow-400 text-yellow-950";
    case "orange":     return "bg-orange-100 border-orange-500 hover:bg-orange-200 text-orange-950";
    case "darkorange": return "bg-orange-400 border-orange-700 hover:bg-orange-500 text-white";
    case "peach":      return "bg-orange-50 border-orange-300 hover:bg-orange-100 text-orange-900";
    case "teal":       return "bg-teal-100 border-teal-500 hover:bg-teal-200 text-teal-950";
    case "darkteal":   return "bg-teal-600 border-teal-800 hover:bg-teal-700 text-teal-50";
    case "sky":        return "bg-sky-100 border-sky-400 hover:bg-sky-200 text-sky-950";
    case "blue":       return "bg-blue-200 border-blue-500 hover:bg-blue-300 text-blue-950";
    case "darkblue":   return "bg-blue-700 border-blue-900 hover:bg-blue-800 text-blue-50";
    case "cyan":       return "bg-cyan-100 border-cyan-400 hover:bg-cyan-200 text-cyan-950";
    case "navy":       return "bg-slate-700 border-slate-900 hover:bg-slate-800 text-slate-50";
    case "indigo":     return "bg-indigo-200 border-indigo-500 hover:bg-indigo-300 text-indigo-950";
    case "violet":     return "bg-violet-200 border-violet-500 hover:bg-violet-300 text-violet-950";
    case "purple":     return "bg-purple-400 border-purple-700 hover:bg-purple-500 text-white";
    case "fuchsia":    return "bg-fuchsia-100 border-fuchsia-400 hover:bg-fuchsia-200 text-fuchsia-950";
    case "pink":       return "bg-pink-100 border-pink-400 hover:bg-pink-200 text-pink-950";
    case "hotpink":    return "bg-pink-400 border-pink-600 hover:bg-pink-500 text-white";
    case "magenta":    return "bg-fuchsia-400 border-fuchsia-600 hover:bg-fuchsia-500 text-white";
    case "slate":      return "bg-slate-100 border-slate-400 hover:bg-slate-200 text-slate-950";
    case "gray":       return "bg-gray-200 border-gray-500 hover:bg-gray-300 text-gray-950";
    case "stone":      return "bg-stone-100 border-stone-400 hover:bg-stone-200 text-stone-900";
    case "brown":      return "bg-amber-700 border-amber-900 hover:bg-amber-800 text-amber-50";
    case "black":      return "bg-neutral-800 border-neutral-950 hover:bg-neutral-900 text-neutral-50";
    case "white":      return "bg-white border-neutral-300 hover:bg-neutral-50 text-neutral-900";
    default:           return "bg-card border-border hover:bg-accent/40";
  }
}

export function statusCardClasses(status: string): string {
  return cardToneClasses(STATUS_TONE[status] ?? "default");
}

export const PENDING_STATUSES: SystemStatus[] = ["pending_check_close", "pending_check_open"];
export function isPendingStatus(s: string): boolean {
  return s === "pending_check_close" || s === "pending_check_open";
}

export const CALLER_SOURCES = [
  { value: "call_center", label: "שיחה במוקד" },
  { value: "message_center", label: "הודעה במוקד" },
  { value: "email", label: "מייל" },
  { value: "personal", label: "אישי" },
] as const;
export const SOURCE_LABEL: Record<string, string> = CALLER_SOURCES.reduce(
  (a, s) => ({ ...a, [s.value]: s.label }), {} as Record<string, string>,
);

// Build "972..." dial from a system_code/phone like "0512345678" or "972..."
export function buildDialNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}
