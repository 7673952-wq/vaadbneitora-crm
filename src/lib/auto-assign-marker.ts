/**
 * Reason marker written by `public.apply_auto_status_assignment`.
 *
 * The DB triggers copy `app.change_reason` into both `system_activity_log.reason`
 * and `system_transfers.reason`, so an agent change caused automatically by a
 * status change carries this marker and can be filtered out of the visible
 * history — while manual transfers (and the status change itself) stay visible.
 */
export const AUTO_ASSIGN_REASON = "__auto_status_assignment__";

/**
 * PostgREST filter that keeps every row except the auto-assignment ones.
 * `neq` alone would also drop rows with a NULL reason, hence the explicit
 * `is.null` branch.
 */
export const HIDE_AUTO_ASSIGN_FILTER = `reason.is.null,reason.neq.${AUTO_ASSIGN_REASON}`;
