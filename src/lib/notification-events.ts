// Catalog of events the notification bell can surface. Kept as a plain
// module (no server imports) so both server and client code can share it.

export type NotificationEventKey =
  | "mention"
  | "email_inbound"
  | "reminder_due"
  | "assigned_to_me"
  | "status_changed_on_my_system"
  | "note_added_to_my_system"
  | "voice_message_sent";

export const NOTIFICATION_EVENTS: {
  key: NotificationEventKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
}[] = [
  { key: "mention",                     label: "תיוג בהערה (@)",             description: "כאשר נציג אחר מתייג אותך בהערה", defaultEnabled: true },
  { key: "email_inbound",               label: "מייל נכנס למערכת שלי",         description: "מייל חדש שהתקבל במערכת שמשויכת אליך", defaultEnabled: true },
  { key: "reminder_due",                label: "תזכורת פעילה",                 description: "תזכורת שהגיעה זמנה במערכת שלך",       defaultEnabled: true },
  { key: "assigned_to_me",              label: "מערכת שוייכה אליי",           description: "כאשר מערכת עוברת אליך",              defaultEnabled: true },
  { key: "status_changed_on_my_system", label: "שינוי סטטוס במערכת שלי",       description: "כאשר נציג אחר משנה סטטוס במערכת שלך", defaultEnabled: false },
  { key: "note_added_to_my_system",     label: "הערה חדשה במערכת שלי",         description: "כאשר נציג אחר מוסיף הערה למערכת שלך", defaultEnabled: false },
  { key: "voice_message_sent",          label: "הודעה קולית נשלחה",           description: "אישור על שליחת הודעה קולית מהמערכת", defaultEnabled: false },
];

export const NOTIFICATION_EVENT_KEYS = NOTIFICATION_EVENTS.map((e) => e.key);

export function isNotificationEventKey(v: unknown): v is NotificationEventKey {
  return typeof v === "string" && (NOTIFICATION_EVENT_KEYS as string[]).includes(v);
}
