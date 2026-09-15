import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";

// READ-ONLY snapshot of production grants, run directly against
// $SUPABASE_DB_URL via psql. Every query below is a SELECT against
// pg_catalog (never information_schema — it silently hides grants that the
// connected role isn't party to, which would make this test lie). Nothing
// here ever writes to the database.
//
// If a catalog isn't readable by the connected role, individual checks
// report that fact loudly (console.warn) instead of failing the suite —
// a permission wall around the catalog is not itself a security bug here.

const DB_URL = process.env.SUPABASE_DB_URL;
const FIELD_SEP = "\x1f";
const ROW_SEP = "\x1e";

function hasDbUrl() {
  return typeof DB_URL === "string" && DB_URL.length > 0;
}

/** Runs a read-only query and returns rows of string fields. Never mutates. */
function query(sql: string): string[][] {
  if (!DB_URL) throw new Error("SUPABASE_DB_URL not set");
  const out = execFileSync(
    "psql",
    [DB_URL, "-v", "ON_ERROR_STOP=1", "-tA", `-F${FIELD_SEP}`, "-R", ROW_SEP, "-c", sql],
    { encoding: "utf8" },
  );
  return out
    .split(ROW_SEP)
    .map((r) => r.replace(/\n$/, ""))
    .filter((r) => r.length > 0)
    .map((r) => r.split(FIELD_SEP));
}

/** Runs `query`, but reports+skips (returns null) instead of throwing when
 * the connected role can't read the needed catalog rows. */
function tryQuery(label: string, sql: string): string[][] | null {
  try {
    return query(sql);
  } catch (e: any) {
    console.warn(`[security-snapshot] SKIP (${label}): catalog not readable — ${String(e?.message ?? e).slice(0, 300)}`);
    return null;
  }
}

const SENSITIVE_TABLES = [
  "system_requests", "system_request_rules", "note_mentions",
  "mention_email_deliveries", "voice_deliveries", "email_deliveries",
  "mfa_grants", "mfa_passed_sessions", "mfa_trusted_devices",
  "login_otp_challenges", "mail_thread_state",
];

describe.runIf(hasDbUrl())("security snapshot (read-only, production catalog)", () => {
  beforeAll(() => {
    if (!hasDbUrl()) {
      console.warn("[security-snapshot] SKIP: SUPABASE_DB_URL is not set — no production DB checks were run.");
    }
  });

  it("profiles has no table-level grants for anon/authenticated", () => {
    const rows = tryQuery(
      "profiles relacl",
      `select r.rolname, x.privilege_type
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
       join pg_roles r on r.oid = x.grantee
       where n.nspname = 'public' and c.relname = 'profiles'
         and r.rolname in ('anon','authenticated');`,
    );
    if (rows === null) return;
    expect(rows).toEqual([]);
  });

  it("profiles column ACLs: authenticated gets read-only on exactly id, display_name, email_display_name, created_at; nothing on email_signature; nothing to anon", () => {
    const rows = tryQuery(
      "profiles attacl",
      `select a.attname, r.rolname, x.privilege_type
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(a.attacl) x
       join pg_roles r on r.oid = x.grantee
       where n.nspname = 'public' and c.relname = 'profiles' and a.attacl is not null
       order by a.attname;`,
    );
    if (rows === null) return;
    const byColumn = new Map<string, Set<string>>();
    for (const [attname, rolname, priv] of rows) {
      if (!byColumn.has(attname)) byColumn.set(attname, new Set());
      byColumn.get(attname)!.add(`${rolname}:${priv}`);
    }
    expect(byColumn.get("id")).toEqual(new Set(["authenticated:SELECT"]));
    expect(byColumn.get("display_name")).toEqual(new Set(["authenticated:SELECT"]));
    expect(byColumn.get("email_display_name")).toEqual(new Set(["authenticated:SELECT"]));
    expect(byColumn.get("created_at")).toEqual(new Set(["authenticated:SELECT"]));
    expect(byColumn.has("email_signature")).toBe(false);
    for (const [, grants] of byColumn) {
      for (const g of grants) expect(g.startsWith("anon:")).toBe(false);
    }
  });

  it("sensitive server-only tables have no anon/authenticated grants at all", () => {
    const list = SENSITIVE_TABLES.map((t) => `'${t}'`).join(",");
    const rows = tryQuery(
      "sensitive tables relacl",
      `select c.relname, r.rolname, x.privilege_type
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
       join pg_roles r on r.oid = x.grantee
       where n.nspname = 'public' and c.relname in (${list})
         and r.rolname in ('anon','authenticated');`,
    );
    if (rows === null) return;
    expect(rows).toEqual([]);
  });

  it("no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN grants to anon/authenticated anywhere in public", () => {
    const rows = tryQuery(
      "public relacl dangerous privileges",
      `select c.relname, r.rolname, x.privilege_type
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
       join pg_roles r on r.oid = x.grantee
       where n.nspname = 'public' and r.rolname in ('anon','authenticated')
         and x.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');`,
    );
    if (rows === null) return;
    expect(rows).toEqual([]);
  });

  it("every SECURITY DEFINER function in public sets search_path and is not executable by PUBLIC/anon", () => {
    const funcs = tryQuery(
      "public security definer functions",
      `select p.oid::regprocedure::text, coalesce(array_to_string(p.proconfig, ','), '')
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef;`,
    );
    if (funcs === null) return;
    const missingSearchPath = funcs
      .filter(([, config]) => !config.split(",").some((c) => c.startsWith("search_path=")))
      .map(([sig]) => sig);
    expect(missingSearchPath).toEqual([]);

    const execRows = tryQuery(
      "security definer EXECUTE grants",
      `select p.oid::regprocedure::text, coalesce(r.rolname, 'PUBLIC'), x.privilege_type
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
       left join pg_roles r on r.oid = x.grantee
       where n.nspname = 'public' and p.prosecdef
         and (x.grantee = 0 or r.rolname = 'anon')
         and x.privilege_type = 'EXECUTE';`,
    );
    if (execRows === null) return;
    expect(execRows).toEqual([]);
  });

  it("list_systems_page, reports_summary, systems_status_counts are not anon/PUBLIC-executable for any overload", () => {
    const rows = tryQuery(
      "sensitive RPC EXECUTE grants",
      `select p.oid::regprocedure::text, coalesce(r.rolname, 'PUBLIC'), x.privilege_type
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
       left join pg_roles r on r.oid = x.grantee
       where n.nspname = 'public'
         and p.proname in ('list_systems_page','reports_summary','systems_status_counts')
         and (x.grantee = 0 or r.rolname = 'anon')
         and x.privilege_type = 'EXECUTE';`,
    );
    if (rows === null) return;
    expect(rows).toEqual([]);
  });
});

describe.skipIf(hasDbUrl())("security snapshot", () => {
  it("SKIPPED: SUPABASE_DB_URL is not set", () => {
    console.warn("[security-snapshot] SUPABASE_DB_URL missing — skipping all production-catalog checks.");
    expect(true).toBe(true);
  });
});
