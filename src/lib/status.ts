export const STATUS_OPTIONS = [
  { value: "pending_check_close", label: "לבדיקה לחסימה", tone: "warning" },
  { value: "pending_check_open", label: "לבדיקה לפתיחה", tone: "warning" },
  { value: "open", label: "פתוח", tone: "success" },
  { value: "closed", label: "סגור", tone: "muted" },
  { value: "problem", label: "בעיה", tone: "danger" },
  { value: "open_only_bimot", label: "לפתוח רק בימות", tone: "info" },
  { value: "close_only_bimot", label: "פתוח רק בימות", tone: "info" },
  { value: "open_in_simahedrin", label: "לפתיחה בסימהדרין", tone: "info" },
  { value: "close_in_simahedrin", label: "לחסימה בסימהדרין", tone: "info" },
  { value: "send_to_yosela", label: "לשלוח ליוסלה", tone: "warning" },
  { value: "block_from_root", label: "לחסום מהשורש", tone: "danger" },
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

export function toneClasses(tone: string): string {
  switch (tone) {
    case "success":
      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "danger":
      return "bg-rose-100 text-rose-800 border border-rose-200";
    case "warning":
      return "bg-amber-100 text-amber-900 border border-amber-200";
    case "info":
      return "bg-sky-100 text-sky-800 border border-sky-200";
    default:
      return "bg-muted text-muted-foreground border border-border";
  }
}
