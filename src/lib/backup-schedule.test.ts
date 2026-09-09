import { describe, it, expect } from "vitest";
import { shouldRunScheduledBackup } from "./backups.server";
import { describeBackupSchedule } from "./backup-schedule-text";

const weekly = { frequency: "weekly" as const, hour: 3, dayOfWeek: 4 };
const daily = { frequency: "daily" as const, hour: 3, dayOfWeek: 4 };

// 2026-09-10 is a Thursday. 00:00Z === 03:00 Asia/Jerusalem (IDT).
const thuAt3 = new Date("2026-09-10T00:00:00Z");
const wedAt3 = new Date("2026-09-09T00:00:00Z");
const thuAt5 = new Date("2026-09-10T02:00:00Z");

describe("shouldRunScheduledBackup", () => {
  it("runs weekly only on the configured day and hour", () => {
    expect(shouldRunScheduledBackup(weekly, null, thuAt3).run).toBe(true);
    expect(shouldRunScheduledBackup(weekly, null, wedAt3).run).toBe(false);
    expect(shouldRunScheduledBackup(weekly, null, thuAt5).run).toBe(false);
  });

  it("does not run a daily backup when the setting is weekly", () => {
    // Same hour, wrong weekday -> nothing happens, even though a daily
    // schedule would have fired here.
    expect(shouldRunScheduledBackup(weekly, null, wedAt3).run).toBe(false);
    expect(shouldRunScheduledBackup(daily, null, wedAt3).run).toBe(true);
  });

  it("does not run twice on the same calendar day", () => {
    const earlier = new Date("2026-09-10T00:01:00Z").toISOString();
    expect(shouldRunScheduledBackup(weekly, earlier, thuAt3).run).toBe(false);
    const lastWeek = new Date("2026-09-03T00:00:00Z").toISOString();
    expect(shouldRunScheduledBackup(weekly, lastWeek, thuAt3).run).toBe(true);
  });
});

describe("describeBackupSchedule", () => {
  it("describes the saved weekly setting and never claims a daily backup", () => {
    const text = describeBackupSchedule({ frequency: "weekly", hour: 3, dayOfWeek: 4 });
    expect(text).toContain("פעם בשבוע");
    expect(text).toContain("חמישי");
    expect(text).toContain("03:00");
    expect(text).not.toContain("כל יום");
  });

  it("describes a daily setting", () => {
    const text = describeBackupSchedule({ frequency: "daily", hour: 2, dayOfWeek: 4 });
    expect(text).toContain("כל יום");
    expect(text).toContain("02:00");
    expect(text).not.toContain("פעם בשבוע");
  });
});
