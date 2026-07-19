-- Lets an admin decide, per agent, what name shows as the outgoing "From"
-- name when that agent sends email from a system card — independent of
-- (and overriding) their regular in-app display_name. Falls back to
-- display_name when not set.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_display_name TEXT;
