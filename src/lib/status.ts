export const STATUS_OPTIONS = [
  { value: "pending_check_close", label: "לבדיקה לחסימה", tone: "amber" },
  { value: "pending_check_open", label: "לבדיקה לפתיחה", tone: "yellow" },
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

// Small badge / chip
export function toneClasses(tone: string): string {
  switch (tone) {
    case "green":
      return "bg-emerald-100 text-emerald-900 border border-emerald-300";
    case "lightgreen":
      return "bg-lime-100 text-lime-900 border border-lime-300";
    case "red":
      return "bg-red-200 text-red-900 border border-red-400";
    case "lightred":
      return "bg-rose-100 text-rose-900 border border-rose-300";
    case "brightred":
      return "bg-red-600 text-white border border-red-700";
    case "amber":
      return "bg-amber-100 text-amber-900 border border-amber-300";
    case "yellow":
      return "bg-yellow-100 text-yellow-900 border border-yellow-300";
    case "orange":
      return "bg-orange-100 text-orange-900 border border-orange-300";
    case "sky":
      return "bg-sky-100 text-sky-900 border border-sky-300";
    case "indigo":
      return "bg-indigo-100 text-indigo-900 border border-indigo-300";
    case "cyan":
      return "bg-cyan-100 text-cyan-900 border border-cyan-300";
    case "violet":
      return "bg-violet-100 text-violet-900 border border-violet-300";
    case "fuchsia":
      return "bg-fuchsia-100 text-fuchsia-900 border border-fuchsia-300";
    default:
      return "bg-muted text-muted-foreground border border-border";
  }
}

// Full card background (lighter, with colored left border accent)
export function cardToneClasses(tone: string): string {
  switch (tone) {
    case "green":
      return "bg-emerald-50 border-emerald-300 hover:bg-emerald-100";
    case "lightgreen":
      return "bg-lime-50 border-lime-300 hover:bg-lime-100";
    case "red":
      return "bg-red-100 border-red-400 hover:bg-red-200";
    case "lightred":
      return "bg-rose-50 border-rose-300 hover:bg-rose-100";
    case "brightred":
      return "bg-red-500 border-red-700 text-white hover:bg-red-600";
    case "amber":
      return "bg-amber-50 border-amber-300 hover:bg-amber-100";
    case "yellow":
      return "bg-yellow-50 border-yellow-300 hover:bg-yellow-100";
    case "orange":
      return "bg-orange-50 border-orange-300 hover:bg-orange-100";
    case "sky":
      return "bg-sky-50 border-sky-300 hover:bg-sky-100";
    case "indigo":
      return "bg-indigo-50 border-indigo-300 hover:bg-indigo-100";
    case "cyan":
      return "bg-cyan-50 border-cyan-300 hover:bg-cyan-100";
    case "violet":
      return "bg-violet-50 border-violet-300 hover:bg-violet-100";
    case "fuchsia":
      return "bg-fuchsia-50 border-fuchsia-300 hover:bg-fuchsia-100";
    default:
      return "bg-card border-border hover:bg-accent/40";
  }
}

export function statusCardClasses(status: string): string {
  return cardToneClasses(STATUS_TONE[status as SystemStatus] ?? "default");
}

export const PENDING_STATUSES: SystemStatus[] = ["pending_check_close", "pending_check_open"];
export function isPendingStatus(s: string): boolean {
  return s === "pending_check_close" || s === "pending_check_open";
}
