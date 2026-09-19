ALTER TABLE public.system_requests
  ADD COLUMN IF NOT EXISTS manual_created_system_id uuid REFERENCES public.systems(id),
  ADD COLUMN IF NOT EXISTS manual_approval_required boolean NOT NULL DEFAULT false;