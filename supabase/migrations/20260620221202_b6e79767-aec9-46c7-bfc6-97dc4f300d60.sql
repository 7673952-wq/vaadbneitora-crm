-- Add 'viewer' role to app_role enum (read-only access)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'viewer';