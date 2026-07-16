-- Every dashboard/system-card load sorts by updated_at (order("updated_at",
-- {ascending:false})) and getStatusCounts/listSystems also filter by it
-- (period/date range), yet there was no index on this column — every one
-- of those queries was doing a full-table sort. This is very likely the
-- dominant cause of the ~10s initial load and the multi-second delay after
-- every status change (which touches updated_at and then re-sorts the list).
CREATE INDEX IF NOT EXISTS systems_updated_at_idx ON public.systems (updated_at DESC);

-- Composite index to serve "filter by status, sorted by updated_at" (the
-- most common dashboard query shape) in a single index scan.
CREATE INDEX IF NOT EXISTS systems_status_updated_at_idx ON public.systems (status, updated_at DESC);

-- secondary_status is filtered on every list/count query but had no index.
CREATE INDEX IF NOT EXISTS systems_secondary_status_idx ON public.systems (secondary_status);
