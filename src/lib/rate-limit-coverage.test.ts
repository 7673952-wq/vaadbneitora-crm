import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every action classified as sensitive must go through the fail-closed DB rate
 * limiter. This test reads the real sources so a limiter that gets removed in a
 * future refactor fails the suite instead of silently disappearing.
 */
const SENSITIVE_ACTIONS: { action: string; scope: string; file: string }[] = [
  { action: "createUser", scope: "admin_user_manage", file: "src/lib/admin.functions.ts" },
  { action: "deleteUser", scope: "admin_user_manage", file: "src/lib/admin.functions.ts" },
  { action: "setUserRole", scope: "admin_user_manage", file: "src/lib/admin.functions.ts" },
  { action: "updateUserDisplayName", scope: "admin_user_manage", file: "src/lib/admin.functions.ts" },
  { action: "updateUserEmail", scope: "admin_user_manage", file: "src/lib/admin.functions.ts" },
  { action: "updateUserPassword", scope: "admin_user_manage", file: "src/lib/admin.functions.ts" },
  { action: "setRolePermission", scope: "admin_permissions", file: "src/lib/admin.functions.ts" },
  { action: "setUserPermission", scope: "admin_permissions", file: "src/lib/admin.functions.ts" },
  { action: "deleteUserPermission", scope: "admin_permissions", file: "src/lib/admin.functions.ts" },
  { action: "listPermissionSettings", scope: "admin_permissions", file: "src/lib/admin.functions.ts" },
  { action: "sendMailboxMessage", scope: "email_send", file: "src/lib/mail.functions.ts" },
  { action: "deleteMailMessage", scope: "mailbox_delete", file: "src/lib/mail.functions.ts" },
  { action: "deleteMailThread", scope: "mailbox_delete", file: "src/lib/mail.functions.ts" },
  { action: "sendSystemEmail", scope: "email_send", file: "src/lib/email.functions.ts" },
  { action: "sendRecordEmail", scope: "email_send", file: "src/lib/email.functions.ts" },
  { action: "deleteSystem", scope: "system_delete", file: "src/lib/systems.functions.ts" },
  { action: "importSystems", scope: "import_export", file: "src/lib/systems.functions.ts" },
  { action: "sendVoiceMessage", scope: "voice_send", file: "src/lib/systems.functions.ts" },
  { action: "backupNow", scope: "backup_manage", file: "src/lib/backups.functions.ts" },
  { action: "deleteBackup", scope: "backup_manage", file: "src/lib/backups.functions.ts" },
  { action: "sendBackupByEmail", scope: "backup_manage", file: "src/lib/backups.functions.ts" },
  { action: "restoreBackup", scope: "backup_restore", file: "src/lib/backups.functions.ts" },
  { action: "saveRequestRule", scope: "request_manage", file: "src/lib/system-requests.functions.ts" },
  { action: "setRequestAutomationSettings", scope: "request_manage", file: "src/lib/system-requests.functions.ts" },
  { action: "decideSystemRequest", scope: "request_decide", file: "src/lib/system-requests.functions.ts" },
];

function handlerBody(source: string, action: string): string {
  const start = source.indexOf(`export const ${action} = createServerFn`);
  if (start < 0) return "";
  const nextExport = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, nextExport < 0 ? source.length : nextExport);
}

describe("sensitive actions are rate limited", () => {
  const cache = new Map<string, string>();
  const read = (file: string) => {
    if (!cache.has(file)) cache.set(file, readFileSync(file, "utf8"));
    return cache.get(file)!;
  };

  for (const { action, scope, file } of SENSITIVE_ACTIONS) {
    it(`${action} enforces the "${scope}" limit`, () => {
      const body = handlerBody(read(file), action);
      expect(body, `${action} not found in ${file}`).not.toBe("");
      expect(body).toMatch(/limitSensitiveAction|enforceDbRateLimit/);
      expect(body).toContain(`"${scope}"`);
    });
  }

  it("every declared scope is used somewhere in production code", () => {
    const limiter = readFileSync("src/lib/db-rate-limit.server.ts", "utf8");
    const declared = [...limiter.matchAll(/^\s{2}(\w+): \{ limit:/gm)].map((m) => m[1]);
    const used = new Set(SENSITIVE_ACTIONS.map((a) => a.scope));
    expect(declared.filter((s) => !used.has(s))).toEqual([]);
  });
});
