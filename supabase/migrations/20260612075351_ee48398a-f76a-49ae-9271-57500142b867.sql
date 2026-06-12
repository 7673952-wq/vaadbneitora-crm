
-- Split log trigger: BEFORE for UPDATE (needs to mutate NEW.handled_pending_at), AFTER for INSERT/DELETE (FK requires row to exist)
DROP TRIGGER IF EXISTS systems_activity_log ON public.systems;

CREATE TRIGGER systems_activity_log_before_update
BEFORE UPDATE ON public.systems
FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();

CREATE TRIGGER systems_activity_log_after_ins_del
AFTER INSERT OR DELETE ON public.systems
FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();
