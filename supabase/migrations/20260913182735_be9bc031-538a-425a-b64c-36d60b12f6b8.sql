REVOKE ALL ON FUNCTION public.create_scan_investigation_for_log(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_scan_to_patrol_session(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_scan_investigation_for_log(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_scan_to_patrol_session(uuid) TO service_role;