export const STATUS_OPTIONS = [
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
] as const;

export type SystemStatus = (typeof STATUS_OPTIONS)[number]["value"];

export const STATUS_LABEL: Record<SystemStatus, string> = STATUS_OPTIONS.reduce(
  (acc, s) => ({ ...acc, [s.value]: s.label }),
  {} as Record<SystemStatus, string>,
);

export const STATUS_TONE: Record<SystemStatus, string> = STATUS_OPTIONS.reduce(
  (acc, s) => ({ ...acc, [s.value]: s.tone }),
  {} as Record<SystemStatus, string>,
);

// Small badge/chip — keep contrast distinct
export function toneClasses(tone: string): string {
  switch (tone) {
    case "green":      return "bg-emerald-200 text-emerald-900 border border-emerald-400";
    case "lightgreen": return "bg-lime-200 text-lime-900 border border-lime-400";
    case "red":        return "bg-red-300 text-red-950 border border-red-500";
    case "lightred":   return "bg-rose-200 text-rose-950 border border-rose-400";
    case "brightred":  return "bg-red-700 text-white border border-red-900";
    case "amber":      return "bg-amber-200 text-amber-950 border border-amber-400";
    case "yellow":     return "bg-yellow-200 text-yellow-950 border border-yellow-400";
    case "teal":       return "bg-teal-200 text-teal-950 border border-teal-500";
    case "orange":     return "bg-orange-200 text-orange-950 border border-orange-400";
    case "sky":        return "bg-sky-200 text-sky-950 border border-sky-400";
    case "indigo":     return "bg-indigo-200 text-indigo-50 border border-indigo-400";
    case "cyan":       return "bg-cyan-200 text-cyan-950 border border-cyan-400";
    case "violet":     return "bg-violet-200 text-violet-50 border border-violet-400";
    case "fuchsia":    return "bg-fuchsia-200 text-fuchsia-950 border border-fuchsia-400";
    default:           return "bg-muted text-muted-foreground border border-border";
  }
}

// Full card background — very distinct between similar reds/greens
export function cardToneClasses(tone: string): string {
  switch (tone) {
    case "green":      return "bg-emerald-100 border-emerald-500 hover:bg-emerald-200 text-emerald-950";
    case "lightgreen": return "bg-lime-50 border-lime-400 hover:bg-lime-100 text-lime-950";
    case "red":        return "bg-red-200 border-red-500 hover:bg-red-300 text-red-950";
    case "lightred":   return "bg-rose-50 border-rose-400 hover:bg-rose-100 text-rose-950";
    case "brightred":  return "bg-red-600 border-red-800 text-white hover:bg-red-700";
    case "amber":      return "bg-amber-50 border-amber-400 hover:bg-amber-100 text-amber-950";
    case "yellow":     return "bg-yellow-50 border-yellow-400 hover:bg-yellow-100 text-yellow-950";
    case "teal":       return "bg-teal-100 border-teal-500 hover:bg-teal-200 text-teal-950";
    case "orange":     return "bg-orange-100 border-orange-500 hover:bg-orange-200 text-orange-950";
    case "sky":        return "bg-sky-100 border-sky-400 hover:bg-sky-200 text-sky-950";
    case "indigo":     return "bg-indigo-100 border-indigo-400 hover:bg-indigo-200 text-indigo-950";
    case "cyan":       return "bg-cyan-100 border-cyan-400 hover:bg-cyan-200 text-cyan-950";
    case "violet":     return "bg-violet-100 border-violet-400 hover:bg-violet-200 text-violet-950";
    case "fuchsia":    return "bg-fuchsia-100 border-fuchsia-400 hover:bg-fuchsia-200 text-fuchsia-950";
    default:           return "bg-card border-border hover:bg-accent/40";
  }
}

export function statusCardClasses(status: string): string {
  return cardToneClasses(STATUS_TONE[status as SystemStatus] ?? "default");
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
