import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Exercises scripts/make-share-archive.sh end to end: run it into a throwaway
// temp dir, then inspect the produced zip directly (never trust the script's
// own stdout for the security assertion — read the archive listing itself).

const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();
const scriptPath = path.join(repoRoot, "scripts", "make-share-archive.sh");

let outDir: string;
let archivePath: string;
let stdout: string;
let exitCode: number | null;

beforeAll(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "share-archive-test-"));
  try {
    stdout = execFileSync("bash", [scriptPath, outDir], { cwd: repoRoot, encoding: "utf8" });
    exitCode = 0;
  } catch (e: any) {
    stdout = String(e?.stdout ?? "");
    exitCode = typeof e?.status === "number" ? e.status : 1;
  }
  const match = stdout.match(/^Archive: (.+)$/m);
  archivePath = match ? match[1].trim() : "";
}, 60_000);

describe("make-share-archive.sh", () => {
  it("exits 0", () => {
    expect(exitCode).toBe(0);
  });

  it("produces a zip file that exists", () => {
    expect(archivePath).toBeTruthy();
    expect(existsSync(archivePath)).toBe(true);
  });

  it("lists no .env and no other secret-looking file", () => {
    const listing = execFileSync("unzip", ["-l", archivePath], { encoding: "utf8" });
    const lines = listing.split("\n").filter((l) => l.trim());
    const names = lines
      .map((l) => l.trim().split(/\s+/).slice(3).join(" "))
      .filter(Boolean);

    const secretLike = names.filter((name) => {
      const base = name.split("/").pop() ?? name;
      if (base === ".env.example") return false; // deliberately kept, documents names only
      if (/^\.env(\..*)?$/.test(base)) return true;
      const lower = name.toLowerCase();
      return (
        lower.includes("credential") ||
        lower.includes("secret") ||
        /(^|[^a-z])key([^a-z]|$)/.test(lower) ||
        lower.endsWith(".pem") ||
        lower.endsWith(".pfx") ||
        lower.endsWith(".p12") ||
        lower.includes("id_rsa") ||
        lower.includes("id_ed25519")
      );
    });
    expect(secretLike).toEqual([]);
    // Sanity: .env.example itself IS allowed through and should be present,
    // proving the filter is discriminating rather than dropping everything.
    expect(names.some((n) => n.endsWith(".env.example"))).toBe(true);
  });

  it("git ls-files DOES contain .env, proving the exclusion is real and not vacuous", () => {
    const tracked = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim());
    expect(tracked).toContain(".env");
  });

  it("has more than 100 entries", () => {
    const listing = execFileSync("unzip", ["-l", archivePath], { encoding: "utf8" });
    const lines = listing.split("\n");
    // unzip -l footer line looks like: "  12345 files" — parse the count directly.
    const footer = lines.find((l) => /\d+\s+files?$/.test(l.trim()));
    const countMatch = footer?.trim().match(/(\d+)\s+files?$/);
    const entryCount = countMatch ? Number(countMatch[1]) : 0;
    expect(entryCount).toBeGreaterThan(100);
  });
});
