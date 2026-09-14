ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.next_patrol_schedule_run(timestamp with time zone, text, integer, integer[]) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.apply_patrol_session_event_count_trigger() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_data_log_submission(uuid, jsonb, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_company_id(uuid) FROM anon;