// Human wording for the automatic-backup schedule. Kept in one place (and
// tested) so the backups screen can never drift back into a hard-coded
// sentence that contradicts the setting saved in ניהול.

export type BackupScheduleLike = {
  frequency: "daily" | "weekly";
  hour: number;
  dayOfWeek: number;
};

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function describeBackupSchedule(schedule: BackupScheduleLike | null | undefined): string {
  if (!schedule) return "מועד הגיבוי האוטומטי נטען...";
  const time = `${String(schedule.hour).padStart(2, "0")}:00`;
  const when =
    schedule.frequency === "weekly"
      ? `פעם בשבוע, ביום ${WEEKDAYS[schedule.dayOfWeek] ?? ""} בשעה ${time}`
      : `כל יום בשעה ${time}`;
  return `גיבוי אוטומטי ${when} (שעון ישראל), נשלח גם למייל שהוגדר תחת "מייל לגיבויים". הבדיקה רצה בראש כל שעה, כך שייתכן איחור של עד שעה. אפשר לשנות את המועד בניהול, ולהפעיל גיבוי ידני בכל רגע.`;
}
