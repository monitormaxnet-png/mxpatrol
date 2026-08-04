-- 1. devices: replace unrestricted ALL/public policy with a tenant-scoped, column-limited update policy
DROP POLICY IF EXISTS "Company members can update their patrol device location" ON public.devices;

CREATE POLICY "Company members can update their patrol device presence"
ON public.devices
FOR UPDATE
TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()))
WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

-- Restrict which columns non-admin company members may update
REVOKE UPDATE ON public.devices FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.devices TO authenticated;
GRANT UPDATE (
  status,
  battery_level,
  last_seen_at,
  current_gps_lat,
  current_gps_lng,
  current_gps_accuracy,
  current_gps_at,
  device_name,
  site_location,
  notes,
  updated_at
) ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;

-- 2. sites: scope policies to authenticated role
DROP POLICY IF EXISTS "Users can manage company sites" ON public.sites;
DROP POLICY IF EXISTS "Users can view company sites" ON public.sites;

CREATE POLICY "Users can view company sites"
ON public.sites
FOR SELECT
TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Users can manage company sites"
ON public.sites
FOR ALL
TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()))
WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

-- 3. Lock down SECURITY DEFINER functions that must not be callable from the API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_due_patrol_session_statuses() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_due_patrol_sessions(timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_patrol_session_progress(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_scan_to_patrol_session(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.advance_due_patrol_session_statuses() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_due_patrol_sessions(timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_patrol_session_progress(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_scan_to_patrol_session(uuid) TO service_role;

-- RLS policies depend on these helpers, so signed-in users keep EXECUTE; anonymous access is removed
REVOKE ALL ON FUNCTION public.get_user_company_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_company_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;