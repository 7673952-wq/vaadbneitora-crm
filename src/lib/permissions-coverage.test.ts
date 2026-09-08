import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PERMISSION_DEFINITIONS } from "@/lib/permissions.config";

// Every permission listed in ניהול → הרשאות must be enforced somewhere on the
// server. Without this test a switch can exist in the UI while the server
// ignores it (exactly the bug this suite was added for).
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "integrations") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

const SERVER_FILES = walk("src/lib")
  .concat(walk("src/routes"))
  .filter((f) => /\.(server|functions)\.tsx?$/.test(f) || f.includes("/routes/api/"));

const SERVER_SOURCE = SERVER_FILES.map((f) => readFileSync(f, "utf8")).join("\n");

describe("permission coverage", () => {
  it("every permission key is enforced by server code", () => {
    const missing = PERMISSION_DEFINITIONS
      .map((d) => d.key)
      .filter((key) => !new RegExp(`["']${key}["']`).test(SERVER_SOURCE));
    expect(missing).toEqual([]);
  });

  it("systems delete and import no longer rely on hard-coded roles only", () => {
    const systems = readFileSync("src/lib/systems.functions.ts", "utf8");
    expect(systems).toContain('ensurePermission(context.userId, "systems_delete")');
    expect(systems).toContain('ensurePermission(context.userId, "import_export")');
    expect(systems).toContain('ensurePermission(context.userId, "notes_write")');
    expect(systems).toContain('ensurePermission(context.userId, "status_change")');
    expect(systems).toContain('ensurePermission(context.userId, "systems_read")');
  });

  it("file management and audit view are permission gated", () => {
    const files = readFileSync("src/lib/system-files.functions.ts", "utf8");
    const audit = readFileSync("src/lib/audit.functions.ts", "utf8");
    expect(files).toContain('"files_manage"');
    expect(audit).toContain('"audit_view"');
    expect(audit).not.toContain('assertRole(context.userId, "super_admin");\n    let q');
  });
});
