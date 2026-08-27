// Server-only pipeline for pticha/sgira request emails relayed from Gmail.
// Everything here is idempotent per gmail_message_id and refuses to perform any
// operational write while the automation is in `off` or `dry_run` mode.

import { evaluateRules, normalizePhone, normalizeSystemCode, parseRequestEmail, type RequestRule } from "@/lib/system-code";

export type AutomationMode = "off" | "dry_run" | "live";

export type IngestPayload = {
  gmailMessageId: string;
  gmailThreadId?: string | null;
  subject?: string | null;
  body?: string | null;
  receivedAt?: string | null;
  attachmentName?: string | null;
  attachmentIndex?: number | null;
};

export async function readAutomationMode(supabaseAdmin: any): Promise<AutomationMode> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "request_automation_mode").maybeSingle();
  const mode = (data?.value as { mode?: string } | null)?.mode;
  return mode === "live" || mode === "off" ? mode : "dry_run";
}

async function readDefaultStatus(supabaseAdmin: any, type: "pticha" | "sgira"): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", `request_default_status_${type}`).maybeSingle();
  const status = (data?.value as { status?: string | null } | null)?.status;
  return status && String(status).trim() ? String(status).trim() : null;
}

async function readRules(supabaseAdmin: any, crmKey: string): Promise<RequestRule[]> {
  const { data } = await supabaseAdmin
    .from("system_request_rules")
    .select("id, crm_key, request_type, from_status, action, to_status, is_active, sort_order")
    .eq("crm_key", crmKey)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return (data ?? []) as RequestRule[];
}

/** All systems whose normalized code matches, parents and sub-systems alike. */
async function findSystemsByNormalizedCode(supabaseAdmin: any, codeNorm: string) {
  const { data } = await supabaseAdmin
    .from("systems")
    .select("id, system_code, status, caller_phone, phone, additional_caller_phones, parent_system_id")
    .limit(2000);
  return ((data ?? []) as any[]).filter((s) => normalizeSystemCode(s.system_code) === codeNorm);
}

async function finish(supabaseAdmin: any, id: string, patch: Record<string, unknown>) {
  await supabaseAdmin.from("system_requests").update(patch).eq("id", id);
}

export async function ingestSystemRequest(supabaseAdmin: any, payload: IngestPayload, crmKey = "yemot") {
  const messageId = String(payload.gmailMessageId || "").trim();
  if (!messageId) return { ok: false, error: "gmailMessageId required" };

  // Concurrency guard: a second simultaneous delivery of the same message
  // backs off instead of racing the first one.
  try {
    const { data: hits } = await supabaseAdmin.rpc("bump_rate_limit", {
      _key: `req:${messageId}`,
      _window_seconds: 60,
    });
    if (Number(hits ?? 0) > 1) return { ok: true, skipped: true, reason: "in_progress" };
  } catch {
    // Lock is best-effort; the unique key below still prevents duplicates.
  }

  const receivedIso = payload.receivedAt ?? new Date().toISOString();
  const parsed = parseRequestEmail({ subject: payload.subject, body: payload.body });

  const insertRow = {
    crm_key: crmKey,
    gmail_message_id: messageId,
    gmail_thread_id: payload.gmailThreadId ?? null,
    request_type: parsed.requestType ?? "pticha",
    request_number: parsed.requestNumber,
    system_code_raw: parsed.systemCodeRaw,
    system_code_norm: parsed.systemCodeNorm,
    caller_phone: parsed.callerPhone,
    caller_phone_norm: parsed.callerPhoneNorm,
    subject: payload.subject ?? null,
    attachment_name: payload.attachmentName ?? null,
    attachment_index: typeof payload.attachmentIndex === "number" ? payload.attachmentIndex : null,
    received_at: receivedIso,
    processing_state: "received",
  };

  await supabaseAdmin.from("system_requests").insert(insertRow).then(() => {}, () => {});
  const { data: row } = await supabaseAdmin
    .from("system_requests").select("*").eq("gmail_message_id", messageId).maybeSingle();
  if (!row) return { ok: false, error: "could not persist request" };
  const req = row as any;
  if (req.processing_state === "done") return { ok: true, duplicate: true, requestId: req.id };

  const mode = await readAutomationMode(supabaseAdmin);
  if (mode === "off") {
    await finish(supabaseAdmin, req.id, {
      processing_state: "done", last_completed_state: "parsed",
      decision_status: "needs_decision", dry_run: true,
    });
    return { ok: true, requestId: req.id, mode, decision: "needs_decision" };
  }
  const dryRun = mode !== "live";

  try {
    // ---- parse ----
    if (!parsed.requestType || !parsed.systemCodeNorm) {
      await finish(supabaseAdmin, req.id, {
        processing_state: "done", last_completed_state: "parsed",
        decision_status: "needs_decision", dry_run: dryRun,
        last_error: !parsed.requestType ? "לא זוהה סוג הבקשה" : "לא זוהה מספר מערכת",
      });
      return { ok: true, requestId: req.id, mode, decision: "needs_decision" };
    }

    // ---- match ----
    const matches = await findSystemsByNormalizedCode(supabaseAdmin, parsed.systemCodeNorm);
    let system = matches.length === 1 ? matches[0] : null;

    if (matches.length > 1) {
      await finish(supabaseAdmin, req.id, {
        processing_state: "done", last_completed_state: "parsed",
        decision_status: "needs_decision", dry_run: dryRun,
        last_error: "נמצאה יותר ממערכת אחת עם מספר זה",
      });
      return { ok: true, requestId: req.id, mode, decision: "needs_decision" };
    }

    if (!system) {
      const defaultStatus = await readDefaultStatus(supabaseAdmin, parsed.requestType);
      if (!defaultStatus) {
        await finish(supabaseAdmin, req.id, {
          processing_state: "done", last_completed_state: "parsed",
          decision_status: "needs_decision", dry_run: dryRun,
          last_error: "לא הוגדר סטטוס ברירת מחדל ליצירת מערכת חדשה",
        });
        return { ok: true, requestId: req.id, mode, decision: "needs_decision" };
      }
      if (dryRun) {
        await finish(supabaseAdmin, req.id, {
          processing_state: "done", last_completed_state: "parsed",
          decision_status: "needs_decision", dry_run: true,
          proposed_status: defaultStatus,
          last_error: "הרצת בדיקה — מערכת חדשה לא נוצרה",
        });
        return { ok: true, requestId: req.id, mode, decision: "needs_decision", wouldCreate: true };
      }
      const { data: created } = await supabaseAdmin.from("systems").insert({
        system_code: parsed.systemCodeRaw ?? parsed.systemCodeNorm,
        name: `מערכת ${parsed.systemCodeNorm}`,
        name_pending: true,
        status: defaultStatus,
        caller_phone: parsed.callerPhone,
        source: "מייל אוטומטי",
      }).select("id, status, caller_phone, phone, additional_caller_phones").maybeSingle();
      if (created) {
        system = created as any;
      } else {
        const again = await findSystemsByNormalizedCode(supabaseAdmin, parsed.systemCodeNorm);
        system = again.length === 1 ? again[0] : null;
      }
      if (!system) throw new Error("יצירת המערכת נכשלה");
    }

    const currentStatus = String(system.status ?? "");
    const rules = await readRules(supabaseAdmin, crmKey);
    const outcome = evaluateRules(rules, parsed.requestType, currentStatus);

    await finish(supabaseAdmin, req.id, {
      processing_state: "matched",
      last_completed_state: "matched",
      system_id: system.id,
      prev_status: currentStatus,
      rule_id: outcome.rule?.id ?? null,
      proposed_status: outcome.toStatus,
      dry_run: dryRun,
    });

    if (dryRun) {
      await finish(supabaseAdmin, req.id, {
        processing_state: "done",
        decision_status: outcome.action === "set_status" ? "needs_decision" : "needs_decision",
      });
      return { ok: true, requestId: req.id, mode, decision: "needs_decision", proposed: outcome.action };
    }

    // ---- caller phone (idempotent claim, then apply) ----
    if (parsed.callerPhoneNorm && !req.phone_added_at) {
      const { data: claimed } = await supabaseAdmin
        .from("system_requests")
        .update({ phone_added_at: new Date().toISOString() })
        .eq("id", req.id)
        .is("phone_added_at", null)
        .select("id")
        .maybeSingle();
      if (claimed) {
        const existing = new Set<string>();
        const primary = normalizePhone(system.caller_phone || system.phone);
        if (primary) existing.add(primary);
        const additional = Array.isArray(system.additional_caller_phones) ? system.additional_caller_phones : [];
        for (const p of additional as any[]) {
          const d = normalizePhone(p?.phone);
          if (d) existing.add(d);
        }
        if (!existing.has(parsed.callerPhoneNorm)) {
          if (!primary) {
            await supabaseAdmin.from("systems").update({ caller_phone: parsed.callerPhone }).eq("id", system.id);
          } else {
            await supabaseAdmin.from("systems")
              .update({ additional_caller_phones: [...additional, { phone: parsed.callerPhone }] })
              .eq("id", system.id);
          }
        }
      }
    }

    // ---- decision ----
    if (outcome.action === "ignore") {
      await finish(supabaseAdmin, req.id, { processing_state: "done", decision_status: "ignored" });
      return { ok: true, requestId: req.id, mode, decision: "ignored" };
    }
    if (outcome.action === "keep") {
      await finish(supabaseAdmin, req.id, { processing_state: "done", decision_status: "kept" });
      return { ok: true, requestId: req.id, mode, decision: "kept" };
    }
    if (outcome.action === "needs_decision" || !outcome.toStatus) {
      await finish(supabaseAdmin, req.id, { processing_state: "done", decision_status: "needs_decision" });
      return { ok: true, requestId: req.id, mode, decision: "needs_decision" };
    }

    if (outcome.toStatus === currentStatus) {
      await finish(supabaseAdmin, req.id, { processing_state: "done", decision_status: "kept" });
      return { ok: true, requestId: req.id, mode, decision: "kept" };
    }

    const { data: applied } = await supabaseAdmin.rpc("apply_request_status_change", {
      _request_id: req.id,
      _system_id: system.id,
      _from_status: currentStatus,
      _to_status: outcome.toStatus,
      _reason: `בקשת ${parsed.requestType === "pticha" ? "פתיחה" : "סגירה"} אוטומטית מהמייל`,
    });
    if (applied === true) {
      const { maybeAutoVoiceForStatus } = await import("@/lib/systems.functions");
      await maybeAutoVoiceForStatus(supabaseAdmin, system.id, outcome.toStatus);
      await finish(supabaseAdmin, req.id, { processing_state: "done", decision_status: "auto_applied" });
      return { ok: true, requestId: req.id, mode, decision: "auto_applied", newStatus: outcome.toStatus };
    }
    await finish(supabaseAdmin, req.id, {
      processing_state: "done", decision_status: "needs_decision",
      last_error: "הסטטוס השתנה בינתיים — נדרשת החלטה ידנית",
    });
    return { ok: true, requestId: req.id, mode, decision: "needs_decision" };
  } catch (e: any) {
    await finish(supabaseAdmin, req.id, {
      processing_state: "failed",
      attempts: Number(req.attempts ?? 0) + 1,
      last_error: String(e?.message ?? e).slice(0, 500),
      error_at: new Date().toISOString(),
    });
    return { ok: false, requestId: req.id, error: String(e?.message ?? e) };
  }
}
