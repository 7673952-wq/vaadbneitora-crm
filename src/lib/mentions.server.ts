// Background worker that turns queued @mentions into emails. Runs both
// inline (best-effort, right after a note is saved) and from the public
// cron webhook, so it must be idempotent and never leave a delivery in an
// unknown limbo state longer than necessary.

const RELAY_URL_KEY = "email_relay_url";
const RELAY_SECRET_KEY = "email_relay_secret";
const BASE_URL_SETTING_KEY = "app_base_url";
const BACKOFF_SECONDS = [60, 300, 900, 3600];

export function validateHttpsBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("כתובת האתר אינה תקינה");
  }
  if (parsed.protocol !== "https:") throw new Error("כתובת האתר חייבת להתחיל ב-https");
  if (!parsed.hostname) throw new Error("כתובת האתר אינה תקינה");
  if (parsed.username || parsed.password) throw new Error("כתובת האתר לא יכולה לכלול פרטי התחברות");
  if (parsed.hash) throw new Error("כתובת האתר לא יכולה לכלול #");
  if (parsed.search) throw new Error("כתובת האתר לא יכולה לכלול פרמטרים");
  const path = parsed.pathname.replace(/\/+$/, "");
  return parsed.origin + path;
}

export function buildAppLink(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function resolveAppBaseUrl(supabaseAdmin: any): Promise<string | null> {
  const fromEnv = process.env.APP_BASE_URL;
  if (fromEnv && fromEnv.trim()) return validateHttpsBaseUrl(fromEnv.trim());
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", BASE_URL_SETTING_KEY).maybeSingle();
  const url = (data as any)?.value?.url as string | undefined;
  if (!url) return null;
  return validateHttpsBaseUrl(url);
}

function escapeHtml(input: string): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ClaimedRow = {
  delivery_id: string;
  mention_id: string;
  attempts: number;
  mentioned_user_id: string;
  mentioned_by: string;
  crm_key: string;
  system_id: string | null;
  record_id: string | null;
  source_type: "system_note" | "crm_record_note";
  source_note_id: string;
};

type Deps = {
  postToRelay?: (url: string, payload: unknown) => Promise<Response>;
  now?: () => Date;
  fetchUserEmail?: (supabaseAdmin: any, userId: string) => Promise<string | null>;
};

async function defaultFetchUserEmail(supabaseAdmin: any, userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) return null;
  return data?.user?.email ?? null;
}

async function loadNoteBody(supabaseAdmin: any, row: ClaimedRow): Promise<string> {
  const table = row.source_type === "system_note" ? "system_notes" : "crm_record_notes";
  const { data } = await supabaseAdmin.from(table).select("body").eq("id", row.source_note_id).maybeSingle();
  return (data as any)?.body ?? "";
}

async function loadContext(
  supabaseAdmin: any,
  row: ClaimedRow,
): Promise<{ title: string; path: string }> {
  if (row.source_type === "system_note" && row.system_id) {
    const { data } = await supabaseAdmin.from("systems").select("system_code, name").eq("id", row.system_id).maybeSingle();
    const sys = data as any;
    const title = sys ? [sys.system_code, sys.name].filter(Boolean).join(" — ") : "מערכת";
    return { title, path: `/systems/${row.system_id}` };
  }
  if (row.record_id) {
    const { data: crm } = await supabaseAdmin.from("crms").select("name").eq("key", row.crm_key).maybeSingle();
    const title = (crm as any)?.name ? String((crm as any).name) : row.crm_key;
    return { title, path: `/c/${row.crm_key}/${row.record_id}` };
  }
  return { title: row.crm_key, path: "/" };
}

async function loadDisplayName(supabaseAdmin: any, userId: string): Promise<string> {
  const { data } = await supabaseAdmin.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return (data as any)?.display_name ?? "משתמש";
}

async function loadRelayConfig(supabaseAdmin: any): Promise<{ url: string; secret: string } | null> {
  const [{ data: urlRow }, { data: secretRow }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_URL_KEY).maybeSingle(),
    supabaseAdmin.from("app_settings").select("value").eq("key", RELAY_SECRET_KEY).maybeSingle(),
  ]);
  const url = (urlRow as any)?.value?.url as string | undefined;
  const secret = (secretRow as any)?.value?.secret as string | undefined;
  if (!url || !secret) return null;
  return { url, secret };
}

export async function processMentionQueue(
  supabaseAdmin: any,
  deps: Deps = {},
): Promise<{ processed: number; sent: number; retried: number; failed: number; skipped: number; unknown: number }> {
  const fetchUserEmail = deps.fetchUserEmail ?? defaultFetchUserEmail;
  const now = deps.now ?? (() => new Date());

  const counts = { processed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, unknown: 0 };

  const { data: rows, error: claimErr } = await supabaseAdmin.rpc("claim_mention_deliveries", {
    _limit: 20,
    _stale_seconds: 600,
  });
  if (claimErr) throw new Error(claimErr.message);
  const deliveries: ClaimedRow[] = (rows as ClaimedRow[]) ?? [];

  if (deliveries.length === 0) return counts;

  const relayConfig = await loadRelayConfig(supabaseAdmin);
  const baseUrlPromise = resolveAppBaseUrl(supabaseAdmin).catch(() => null);

  for (const row of deliveries) {
    counts.processed += 1;
    try {
      const email = await fetchUserEmail(supabaseAdmin, row.mentioned_user_id);
      if (!email) {
        await supabaseAdmin.rpc("finish_mention_delivery", {
          _delivery_id: row.delivery_id,
          _status: "skipped_no_email",
        });
        counts.skipped += 1;
        continue;
      }

      let baseUrl: string | null;
      try {
        baseUrl = await baseUrlPromise;
      } catch {
        baseUrl = null;
      }
      if (!baseUrl) {
        await supabaseAdmin.rpc("finish_mention_delivery", {
          _delivery_id: row.delivery_id,
          _status: "failed",
          _error: "APP_BASE_URL אינו מוגדר — הגדר בניהול → התראות → תורי רקע",
        });
        counts.failed += 1;
        continue;
      }

      if (!relayConfig) {
        const attempts = (row.attempts ?? 0) + 1;
        if (attempts < 5) {
          await supabaseAdmin.rpc("finish_mention_delivery", {
            _delivery_id: row.delivery_id,
            _status: "pending",
            _error: "שליחת מייל לא מוגדרת עדיין",
            _retry_in_seconds: BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1],
          });
          counts.retried += 1;
        } else {
          await supabaseAdmin.rpc("finish_mention_delivery", {
            _delivery_id: row.delivery_id,
            _status: "failed",
            _error: "שליחת מייל לא מוגדרת עדיין",
          });
          counts.failed += 1;
        }
        continue;
      }

      const [authorName, noteBody, ctx] = await Promise.all([
        loadDisplayName(supabaseAdmin, row.mentioned_by),
        loadNoteBody(supabaseAdmin, row),
        loadContext(supabaseAdmin, row),
      ]);

      const link = buildAppLink(baseUrl, ctx.path);
      const subject = `תויגת בהערה — ${authorName}`;
      const escapedBody = escapeHtml(noteBody).replace(/\n/g, "<br>");
      const html = `<div dir="rtl" style="font-family:Arial,sans-serif;text-align:right;">
  <p><strong>${escapeHtml(authorName)}</strong> תייג/ה אותך בהערה:</p>
  <blockquote style="border-right:3px solid #ccc;padding-right:10px;margin:10px 0;">${escapedBody}</blockquote>
  <p>הקשר: ${escapeHtml(ctx.title)}</p>
  <p><a href="${link}" style="display:inline-block;padding:8px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">לצפייה</a></p>
</div>`;
      const text = `${authorName} תייג/ה אותך בהערה:\n\n${noteBody}\n\nהקשר: ${ctx.title}\n${link}`;

      const postToRelay = deps.postToRelay ?? (await import("@/lib/relay.server")).postToRelay;

      let relayOk = false;
      let relayError: string | null = null;
      try {
        const res = await postToRelay(relayConfig.url, {
          action: "send_notification",
          secret: relayConfig.secret,
          to: email,
          subject,
          text,
          html,
          idempotencyKey: row.delivery_id,
        });
        const json: any = await res.json().catch(() => ({}));
        relayOk = res.ok && !!json?.ok;
        if (!relayOk) relayError = json?.error ?? "שליחה נכשלה";
      } catch (e: any) {
        relayOk = false;
        relayError = e?.message ?? "שגיאת רשת בשליחה";
      }

      if (relayOk) {
        const { error: finishErr } = await supabaseAdmin.rpc("finish_mention_delivery", {
          _delivery_id: row.delivery_id,
          _status: "sent",
        });
        if (finishErr) {
          const { logger } = await import("@/lib/logger.server");
          logger.info("[mentions] finish_mention_delivery(sent) failed", { delivery_id: row.delivery_id, message: finishErr.message });
          counts.unknown += 1;
        } else {
          counts.sent += 1;
        }
      } else {
        const attempts = (row.attempts ?? 0) + 1;
        if (attempts < 5) {
          await supabaseAdmin.rpc("finish_mention_delivery", {
            _delivery_id: row.delivery_id,
            _status: "pending",
            _error: relayError ?? "שליחה נכשלה",
            _retry_in_seconds: BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1],
          });
          counts.retried += 1;
        } else {
          await supabaseAdmin.rpc("finish_mention_delivery", {
            _delivery_id: row.delivery_id,
            _status: "failed",
            _error: relayError ?? "שליחה נכשלה",
          });
          counts.failed += 1;
        }
      }
    } catch (e: any) {
      const { logger } = await import("@/lib/logger.server");
      logger.error("[mentions] delivery processing failed", { delivery_id: row.delivery_id, message: e?.message ?? e });
      counts.failed += 1;
      try {
        await supabaseAdmin.rpc("finish_mention_delivery", {
          _delivery_id: row.delivery_id,
          _status: "failed",
          _error: e?.message ?? "שגיאה לא צפויה",
        });
      } catch {
        // give up quietly — the stale claim will be reclaimed later.
      }
    }
  }

  void now(); // reserved for future clock-injection needs

  try {
    await supabaseAdmin.rpc("drain_mention_queue_job");
  } catch {
    // best-effort only
  }

  return counts;
}
