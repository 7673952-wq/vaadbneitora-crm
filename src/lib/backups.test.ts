import { describe, it, expect } from "vitest";
import { shouldRunScheduledBackup, selectExpiredBackupFolders } from "./backups.server";
import { sanitizeCell } from "./csv-safe";

// Jerusalem is UTC+3 in August (DST), UTC+2 in January.
const at = (iso: string) => new Date(iso);

describe("shouldRunScheduledBackup", () => {
  const daily = { frequency: "daily" as const, hour: 2, dayOfWeek: 4 };

  it("runs at the configured Jerusalem hour", () => {
    // 23:00Z = 02:00 Jerusalem (summer)
    expect(shouldRunScheduledBackup(daily, null, at("2026-08-12T23:00:00Z")).run).toBe(true);
  });

  it("does not run at other hours", () => {
    expect(shouldRunScheduledBackup(daily, null, at("2026-08-12T20:00:00Z")).run).toBe(false);
  });

  it("respects winter time (UTC+2)", () => {
    // 00:00Z = 02:00 Jerusalem (winter)
    expect(shouldRunScheduledBackup(daily, null, at("2026-01-12T00:00:00Z")).run).toBe(true);
    expect(shouldRunScheduledBackup(daily, null, at("2026-01-12T23:00:00Z")).run).toBe(false);
  });

  it("only runs once per day even though the heartbeat fires 4x per hour", () => {
    const now = at("2026-08-12T23:30:00Z");
    expect(shouldRunScheduledBackup(daily, "2026-08-12T23:00:00Z", now).run).toBe(false);
  });

  it("weekly only runs on the configured weekday", () => {
    const weekly = { frequency: "weekly" as const, hour: 2, dayOfWeek: 4 }; // Thursday
    // 2026-08-12T23:00Z -> Thursday 13/08 02:00 Jerusalem
    expect(shouldRunScheduledBackup(weekly, null, at("2026-08-12T23:00:00Z")).run).toBe(true);
    // 2026-08-13T23:00Z -> Friday
    expect(shouldRunScheduledBackup(weekly, null, at("2026-08-13T23:00:00Z")).run).toBe(false);
  });
});

describe("selectExpiredBackupFolders", () => {
  const now = at("2026-08-13T12:00:00Z");
  const folder = (iso: string) => iso.replace(/[:.]/g, "-");

  it("keeps everything inside the daily window", () => {
    const folders = [folder("2026-08-12T02:00:00.000Z"), folder("2026-08-01T02:00:00.000Z")];
    expect(selectExpiredBackupFolders(folders, { dailyDays: 30, weeklyDays: 365 }, now)).toEqual([]);
  });

  it("keeps one backup per week beyond the daily window", () => {
    const folders = [
      folder("2026-06-01T02:00:00.000Z"),
      folder("2026-06-02T02:00:00.000Z"), // same week -> pruned
      folder("2026-06-10T02:00:00.000Z"),
    ];
    const expired = selectExpiredBackupFolders(folders, { dailyDays: 30, weeklyDays: 365 }, now);
    expect(expired).toEqual([folder("2026-06-01T02:00:00.000Z")]);
  });

  it("deletes everything older than the weekly window", () => {
    const folders = [folder("2024-01-01T02:00:00.000Z")];
    expect(selectExpiredBackupFolders(folders, { dailyDays: 30, weeklyDays: 365 }, now)).toEqual(folders);
  });

  it("ignores folders that are not timestamps", () => {
    expect(selectExpiredBackupFolders(["not-a-backup"], { dailyDays: 1, weeklyDays: 2 }, now)).toEqual([]);
  });
});

describe("sanitizeCell", () => {
  it("neutralizes formula injection", () => {
    expect(String(sanitizeCell("=1+1"))).toMatch(/^'/);
    expect(String(sanitizeCell("+SUM(A1)"))).toMatch(/^'/);
  });
  it("leaves plain values alone", () => {
    expect(sanitizeCell("שלום")).toBe("שלום");
  });
});
