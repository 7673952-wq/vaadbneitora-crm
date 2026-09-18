import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Two-CRM RLS mutation harness.
 *
 * This suite performs REAL writes (insert/update/delete) against a live
 * Supabase project using a service-role key, then exercises Row Level
 * Security as an authenticated "agent" and "viewer" user. Because it
 * mutates data, it is opt-in only and is hard-blocked from ever touching
 * the production project referenced by VITE_SUPABASE_URL.
 *
 * Required env vars to actually run:
 *   RLS_TEST_SUPABASE_URL       - URL of a disposable/test Supabase project
 *   RLS_TEST_SERVICE_KEY        - service_role key for that project
 *   RLS_TEST_ALLOW_MUTATIONS=1  - explicit opt-in switch
 */

const RLS_TEST_SUPABASE_URL = process.env.RLS_TEST_SUPABASE_URL;
const RLS_TEST_SERVICE_KEY = process.env.RLS_TEST_SERVICE_KEY;
const RLS_TEST_ALLOW_MUTATIONS = process.env.RLS_TEST_ALLOW_MUTATIONS;

const missing: string[] = [];
if (!RLS_TEST_SUPABASE_URL) missing.push("RLS_TEST_SUPABASE_URL");
if (!RLS_TEST_SERVICE_KEY) missing.push("RLS_TEST_SERVICE_KEY");
if (RLS_TEST_ALLOW_MUTATIONS !== "1") missing.push("RLS_TEST_ALLOW_MUTATIONS=1");

const shouldRun = missing.length === 0;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

if (shouldRun) {
  // Hard safety rail: never let this suite mutate the production project,
  // no matter how the env vars are set up.
  const prodUrl = process.env.VITE_SUPABASE_URL;
  if (prodUrl && hostOf(prodUrl) === hostOf(RLS_TEST_SUPABASE_URL!)) {
    throw new Error(
      `rls-integration.test.ts: RLS_TEST_SUPABASE_URL host (${hostOf(RLS_TEST_SUPABASE_URL!)}) ` +
        `matches VITE_SUPABASE_URL host (${hostOf(prodUrl)}). Refusing to run mutation tests ` +
        `against what appears to be the production project.`,
    );
  }
}

const describeMaybe = shouldRun ? describe : describe.skip;

if (!shouldRun) {
  // eslint-disable-next-line no-console
  console.log(
    `[rls-integration.test.ts] SKIPPING: missing/unsatisfied env var(s): ${missing.join(", ")}. ` +
      `Set RLS_TEST_SUPABASE_URL, RLS_TEST_SERVICE_KEY and RLS_TEST_ALLOW_MUTATIONS=1 against a ` +
      `disposable Supabase project to run this real-mutation RLS suite.`,
  );
}

describeMaybe("RLS: cross-CRM isolation and role enforcement (live mutations)", () => {
  // NOTE: describe.skip still executes this function body (just not the
  // it()/beforeAll/afterAll callbacks), so nothing here may eagerly touch
  // env vars that are only guaranteed present when shouldRun is true.
  let admin: SupabaseClient<Database>;

  const anonKey =
    process.env.RLS_TEST_ANON_KEY /* optional override */ ?? RLS_TEST_SERVICE_KEY!;

  const suffix = `rls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const crmAKey = `${suffix}-a`;
  const crmBKey = `${suffix}-b`;

  const agentEmail = `agent-${suffix}@example.test`;
  const viewerEmail = `viewer-${suffix}@example.test`;
  const password = "Test-Password-1234!";

  let agentUserId = "";
  let viewerUserId = "";
  let recordAId = "";
  let recordBId = "";

  let agentClient: SupabaseClient<Database>;
  let viewerClient: SupabaseClient<Database>;

  function newAnonClient(): SupabaseClient<Database> {
    return createClient<Database>(RLS_TEST_SUPABASE_URL!, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  beforeAll(async () => {
    admin = createClient<Database>(RLS_TEST_SUPABASE_URL!, RLS_TEST_SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Two CRMs.
    const { error: crmError } = await admin.from("crms").insert([
      { key: crmAKey, name: `RLS Test CRM A ${suffix}`, record_table: "crm_records" },
      { key: crmBKey, name: `RLS Test CRM B ${suffix}`, record_table: "crm_records" },
    ]);
    if (crmError) throw new Error(`Failed to seed crms: ${crmError.message}`);

    // 2. Agent + viewer auth users, both created via admin API.
    const { data: agentCreate, error: agentCreateErr } = await admin.auth.admin.createUser({
      email: agentEmail,
      password,
      email_confirm: true,
    });
    if (agentCreateErr || !agentCreate.user) {
      throw new Error(`Failed to create agent user: ${agentCreateErr?.message}`);
    }
    agentUserId = agentCreate.user.id;

    const { data: viewerCreate, error: viewerCreateErr } = await admin.auth.admin.createUser({
      email: viewerEmail,
      password,
      email_confirm: true,
    });
    if (viewerCreateErr || !viewerCreate.user) {
      throw new Error(`Failed to create viewer user: ${viewerCreateErr?.message}`);
    }
    viewerUserId = viewerCreate.user.id;

    // 3. Role scoping: agent is "agent" on CRM A only. Viewer is "viewer" on CRM A only.
    const { error: rolesErr } = await admin.from("crm_user_roles").insert([
      { crm_key: crmAKey, user_id: agentUserId, role: "agent" },
      { crm_key: crmAKey, user_id: viewerUserId, role: "viewer" },
    ]);
    if (rolesErr) throw new Error(`Failed to seed crm_user_roles: ${rolesErr.message}`);

    // 4. Seed one record per CRM.
    const { data: recA, error: recAErr } = await admin
      .from("crm_records")
      .insert({ crm_key: crmAKey, name: "Record A", record_code: `${suffix}-rec-a` })
      .select("id")
      .single();
    if (recAErr || !recA) throw new Error(`Failed to seed CRM A record: ${recAErr?.message}`);
    recordAId = recA.id;

    const { data: recB, error: recBErr } = await admin
      .from("crm_records")
      .insert({ crm_key: crmBKey, name: "Record B", record_code: `${suffix}-rec-b` })
      .select("id")
      .single();
    if (recBErr || !recB) throw new Error(`Failed to seed CRM B record: ${recBErr?.message}`);
    recordBId = recB.id;

    // 5. Sign in as the agent and the viewer via fresh anon clients.
    agentClient = newAnonClient();
    const { error: agentSignInErr } = await agentClient.auth.signInWithPassword({
      email: agentEmail,
      password,
    });
    if (agentSignInErr) throw new Error(`Agent sign-in failed: ${agentSignInErr.message}`);

    viewerClient = newAnonClient();
    const { error: viewerSignInErr } = await viewerClient.auth.signInWithPassword({
      email: viewerEmail,
      password,
    });
    if (viewerSignInErr) throw new Error(`Viewer sign-in failed: ${viewerSignInErr.message}`);
  });

  afterAll(async () => {
    // Clean up in FK-safe order: notes -> records -> roles -> users -> crms.
    await admin.from("crm_record_notes").delete().in("crm_key", [crmAKey, crmBKey]);
    await admin.from("crm_records").delete().in("crm_key", [crmAKey, crmBKey]);
    await admin.from("crm_user_roles").delete().in("crm_key", [crmAKey, crmBKey]);
    if (agentUserId) await admin.auth.admin.deleteUser(agentUserId);
    if (viewerUserId) await admin.auth.admin.deleteUser(viewerUserId);
    await admin.from("crms").delete().in("key", [crmAKey, crmBKey]);
  });

  it("agent scoped to CRM A cannot SELECT CRM B's records", async () => {
    const { data, error } = await agentClient
      .from("crm_records")
      .select("id")
      .eq("id", recordBId);

    // RLS makes the row invisible rather than erroring: expect empty result set.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("agent scoped to CRM A cannot UPDATE CRM B's record", async () => {
    const { data, error } = await agentClient
      .from("crm_records")
      .update({ name: "hacked by agent" })
      .eq("id", recordBId)
      .select("id");

    // RLS filters the row out of the update's affected set; no rows change.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const { data: check } = await admin.from("crm_records").select("name").eq("id", recordBId).single();
    expect(check?.name).toBe("Record B");
  });

  it("agent scoped to CRM A cannot DELETE CRM B's record", async () => {
    const { data, error } = await agentClient
      .from("crm_records")
      .delete()
      .eq("id", recordBId)
      .select("id");

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const { data: check } = await admin.from("crm_records").select("id").eq("id", recordBId).single();
    expect(check?.id).toBe(recordBId);
  });

  it("a cross-CRM note insert (crm_key mismatched to the record's real CRM) is refused", async () => {
    // Agent attempts to attach a note tagged with CRM B onto CRM A's own record,
    // and separately attempts a note directly against CRM B's record while
    // authenticated only against CRM A. Both must be rejected by RLS.
    const { data: crossTagged, error: crossTaggedErr } = await agentClient
      .from("crm_record_notes")
      .insert({ crm_key: crmBKey, record_id: recordAId, body: "cross-crm note attempt" })
      .select("id");
    expect(crossTaggedErr).not.toBeNull();
    expect(crossTagged ?? null).toBeNull();

    const { data: onOtherCrm, error: onOtherCrmErr } = await agentClient
      .from("crm_record_notes")
      .insert({ crm_key: crmBKey, record_id: recordBId, body: "note on foreign record" })
      .select("id");
    expect(onOtherCrmErr).not.toBeNull();
    expect(onOtherCrm ?? null).toBeNull();

    const { data: leftovers } = await admin
      .from("crm_record_notes")
      .select("id")
      .eq("crm_key", crmBKey);
    expect(leftovers ?? []).toHaveLength(0);
  });

  it("a viewer-role user cannot write (insert/update/delete) CRM records or notes", async () => {
    const { data: insertData, error: insertErr } = await viewerClient
      .from("crm_records")
      .insert({ crm_key: crmAKey, name: "viewer created", record_code: `${suffix}-viewer-insert` })
      .select("id");
    expect(insertErr).not.toBeNull();
    expect(insertData ?? null).toBeNull();

    const { data: updateData, error: updateErr } = await viewerClient
      .from("crm_records")
      .update({ name: "viewer edited" })
      .eq("id", recordAId)
      .select("id");
    expect(updateErr).toBeNull();
    expect(updateData ?? []).toHaveLength(0);

    const { data: check } = await admin.from("crm_records").select("name").eq("id", recordAId).single();
    expect(check?.name).toBe("Record A");

    const { data: noteData, error: noteErr } = await viewerClient
      .from("crm_record_notes")
      .insert({ crm_key: crmAKey, record_id: recordAId, body: "viewer note attempt" })
      .select("id");
    expect(noteErr).not.toBeNull();
    expect(noteData ?? null).toBeNull();

    // Viewer CAN still read within their own CRM (sanity check the harness itself works).
    const { data: readBack, error: readErr } = await viewerClient
      .from("crm_records")
      .select("id")
      .eq("id", recordAId);
    expect(readErr).toBeNull();
    expect(readBack ?? []).toHaveLength(1);
  });
});
