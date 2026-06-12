DROP TRIGGER IF EXISTS systems_activity_log_after_ins_del ON public.systems;
CREATE TRIGGER systems_activity_log_after_insert AFTER INSERT ON public.systems FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();
CREATE TRIGGER systems_activity_log_before_delete BEFORE DELETE ON public.systems FOR EACH ROW EXECUTE FUNCTION public.log_system_changes();