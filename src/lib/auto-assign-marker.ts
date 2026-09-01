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

/**
 * True for a `system_activity_log` / `system_transfers` row created by the
 * automatic status-driven assignment (including rows propagated to
 * sub-systems, which run inside the same transaction and inherit the marker).
 */
export function isAutoAssignmentRow(row: { reason?: string | null } | null | undefined): boolean {
  return Boolean(row && row.reason === AUTO_ASSIGN_REASON);
}
