
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'agent');

-- System status enum (Hebrew values stored as text labels)
CREATE TYPE public.system_status AS ENUM (
  'open',
  'closed',
  'pending_check_close',
  'pending_check_open',
  'problem',
  'open_only_bimot',
  'close_only_bimot',
  'open_in_simahedrin',
  'close_in_simahedrin',
  'send_to_yosela',
  'block_from_root'
);

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- systems
CREATE TABLE public.systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status public.system_status NOT NULL DEFAULT 'open',
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systems TO authenticated;
GRANT ALL ON public.systems TO service_role;
ALTER TABLE public.systems ENABLE ROW LEVEL SECURITY;
CREATE INDEX systems_assigned_agent_idx ON public.systems(assigned_agent_id);
CREATE INDEX systems_status_idx ON public.systems(status);
CREATE INDEX systems_created_at_idx ON public.systems(created_at DESC);

-- system_transfers history
CREATE TABLE public.system_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  from_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  transferred_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.system_transfers TO authenticated;
GRANT ALL ON public.system_transfers TO service_role;
ALTER TABLE public.system_transfers ENABLE ROW LEVEL SECURITY;
CREATE INDEX transfers_system_idx ON public.system_transfers(system_id);

-- system_notes (notes per system, by agents/admins)
CREATE TABLE public.system_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_notes TO authenticated;
GRANT ALL ON public.system_notes TO service_role;
ALTER TABLE public.system_notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX notes_system_idx ON public.system_notes(system_id);

-- RLS policies
-- profiles: everyone authenticated reads, only self/admin update
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- user_roles: read all (needed to display agent roles), only admin write
CREATE POLICY "roles_select_all" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_write" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- systems: admin all; agents view all but edit only own assigned
CREATE POLICY "systems_select_all" ON public.systems FOR SELECT TO authenticated USING (true);
CREATE POLICY "systems_insert_admin" ON public.systems FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "systems_update_admin_or_assigned" ON public.systems FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR assigned_agent_id = auth.uid());
CREATE POLICY "systems_delete_admin" ON public.systems FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- transfers: all authenticated read; insert by admin or current agent
CREATE POLICY "transfers_select_all" ON public.system_transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "transfers_insert" ON public.system_transfers FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = transferred_by);

-- notes: all read; author/admin write
CREATE POLICY "notes_select_all" ON public.system_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "notes_insert_self" ON public.system_notes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);
CREATE POLICY "notes_update_admin_or_author" ON public.system_notes FOR UPDATE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "notes_delete_admin_or_author" ON public.system_notes FOR DELETE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER systems_touch BEFORE UPDATE ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  -- First user becomes admin; others default to agent
  IF (SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin') = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-log transfer when assigned_agent_id changes
CREATE OR REPLACE FUNCTION public.log_system_transfer() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    INSERT INTO public.system_transfers (system_id, from_agent_id, to_agent_id, transferred_by)
    VALUES (NEW.id, OLD.assigned_agent_id, NEW.assigned_agent_id, auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER systems_log_transfer AFTER UPDATE OF assigned_agent_id ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.log_system_transfer();
