
CREATE TABLE IF NOT EXISTS public.dashboard_saved_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_saved_views TO authenticated;
GRANT ALL ON public.dashboard_saved_views TO service_role;
ALTER TABLE public.dashboard_saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_views_select" ON public.dashboard_saved_views FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_views_insert" ON public.dashboard_saved_views FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_views_update" ON public.dashboard_saved_views FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_views_delete" ON public.dashboard_saved_views FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS dashboard_saved_views_user_idx ON public.dashboard_saved_views(user_id, created_at DESC);
CREATE TRIGGER dashboard_saved_views_touch BEFORE UPDATE ON public.dashboard_saved_views FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
