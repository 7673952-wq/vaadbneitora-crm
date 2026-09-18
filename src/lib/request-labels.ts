/** Hebrew labels for the raw enum-like values stored on system_requests rows. */

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  pticha: "פתיחה",
  sgira: "סגירה",
};

export const DECISION_STATUS_LABELS: Record<string, string> = {
  needs_decision: "דורש החלטה",
  auto_applied: "עודכן אוטומטית",
  manual_applied: "עודכן ידנית",
  kept: "הושאר ללא שינוי",
  ignored: "התעלמות",
  simulated: "סימולציה (מצב בדיקה)",
};

export const PROCESSING_STATE_LABELS: Record<string, string> = {
  received: "התקבל",
  processing: "בעיבוד",
  done: "הושלם",
  failed: "נכשל",
  retry: "ממתין לניסיון חוזר",
};

export const PROPOSED_ACTION_LABELS: Record<string, string> = {
  set_status: "שינוי סטטוס",
  create_system: "יצירת מערכת",
  none: "ללא פעולה",
};

function labelFrom(map: Record<string, string>, value: unknown, fallback: string): string {
  if (value == null || value === "") return fallback;
  const key = String(value);
  return map[key] ?? fallback;
}

export function requestTypeLabel(value: unknown): string {
  return labelFrom(REQUEST_TYPE_LABELS, value, "סוג בקשה לא זוהה");
}

export function decisionStatusLabel(value: unknown): string {
  return labelFrom(DECISION_STATUS_LABELS, value, value ? "סטטוס לא ידוע" : "בעיבוד");
}

export function processingStateLabel(value: unknown): string {
  return labelFrom(PROCESSING_STATE_LABELS, value, "לא ידוע");
}

export function proposedActionLabel(value: unknown): string {
  return labelFrom(PROPOSED_ACTION_LABELS, value, "לא ידוע");
}
