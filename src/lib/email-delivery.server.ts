// Idempotency wrapper around the `email_deliveries` table for the Gmail
// relay. Every server function that actually posts an email must call
// beginEmailDelivery() before touching the relay and finishEmailDelivery()
// after — see email.functions.ts / mail.functions.ts for the call sites.
//
// The heavy lifting (dedupe, staleness, ownership) lives in the DB via
// begin_email_delivery / finish_email_delivery (service-role only), so this
// file is a thin, easily-testable adapter — the RPC args are the contract,
// not a schema import, so it can be unit tested with a plain fake client.

export type BeginEmailDeliveryAction = "proceed" | "duplicate" | "busy" | "unknown";

export type BeginEmailDeliveryResult = {
  action: BeginEmailDeliveryAction;
  status?: string;
  message_id?: string;
};

export type FinishEmailDeliveryStatus = "sent" | "failed" | "unknown";

/** Minimal shape used from supabaseAdmin — keeps this file mockable without importing the real client type. */
export type DeliveryRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

export async function beginEmailDelivery(
  admin: DeliveryRpcClient,
  args: { key: string; kind: string; actor: string; target: unknown; staleSeconds?: number },
): Promise<BeginEmailDeliveryResult> {
  const { data, error } = await admin.rpc("begin_email_delivery", {
    _key: args.key,
    _kind: args.kind,
    _actor: args.actor,
    _target: args.target ?? {},
    _stale_seconds: args.staleSeconds ?? 300,
  });
  // Fail closed: if the idempotency check itself can't run, we must not risk
  // a duplicate send by calling the relay anyway.
  if (error) throw new Error("בדיקת כפילות שליחה נכשלה — נסה שוב");
  const result = data as BeginEmailDeliveryResult | null;
  if (!result || !result.action) throw new Error("בדיקת כפילות שליחה נכשלה — נסה שוב");
  return result;
}

export async function finishEmailDelivery(
  admin: DeliveryRpcClient,
  args: { key: string; status: FinishEmailDeliveryStatus; error?: string; relayMessageId?: string; relayThreadId?: string },
): Promise<boolean> {
  const { data, error } = await admin.rpc("finish_email_delivery", {
    _key: args.key,
    _status: args.status,
    _error: args.error,
    _relay_message_id: args.relayMessageId,
    _relay_thread_id: args.relayThreadId,
  });
  // finish is best-effort from the caller's point of view: a failure here
  // must never be surfaced as "the send failed" once the relay succeeded.
  if (error) return false;
  return !!data;
}

/** User-facing Hebrew errors for the two non-proceed, non-duplicate outcomes. */
export function idempotencyErrorFor(action: "busy" | "unknown"): Error {
  if (action === "busy") return new Error("השליחה כבר מתבצעת — המתן לסיומה");
  return new Error("תוצאת השליחה הקודמת אינה ודאית (ייתכן שהמייל כבר נשלח). פתח טיוטה חדשה כדי לשלוח שוב");
}
