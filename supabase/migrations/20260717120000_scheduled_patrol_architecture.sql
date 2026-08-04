-- Scheduled patrol architecture foundation.
-- Additive by design: existing RG360 scan inserts keep working when no patrol session exists.

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.patrol_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  expected_duration_minutes integer NOT NULL DEFAULT 60 CHECK (expected_duration_minutes > 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patrol_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.patrol_templates(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patrol_route_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES public.checkpoints(id) ON DELETE RESTRICT,
  sequence_order integer NOT NULL CHECK (sequence_order > 0),
  expected_arrival_offset_minutes integer CHECK (expected_arrival_offset_minutes IS NULL OR expected_arrival_offset_minutes >= 0),
  expected_offset_minutes integer CHECK (expected_offset_minutes IS NULL OR expected_offset_minutes >= 0),
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, checkpoint_id),
  UNIQUE (route_id, sequence_order)
);

CREATE TABLE IF NOT EXISTS public.patrol_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.patrol_templates(id) ON DELETE SET NULL,
  route_id uuid NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly', 'daily', 'weekly', 'custom', 'every_n_minutes', 'every_n_hours')),
  frequency_type text NOT NULL DEFAULT 'daily' CHECK (frequency_type IN ('hourly', 'daily', 'weekly', 'custom', 'every_n_minutes', 'every_n_hours')),
  interval_value integer NOT NULL DEFAULT 1 CHECK (interval_value > 0),
  start_time time,
  end_time time,
  days_of_week integer[] NOT NULL DEFAULT '{}'::integer[],
  timezone text NOT NULL DEFAULT 'Africa/Gaborone',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  next_run_at timestamptz,
  active_from timestamptz DEFAULT now(),
  active_until timestamptz,
  grace_start_minutes integer NOT NULL DEFAULT 10,
  grace_completion_minutes integer NOT NULL DEFAULT 40,
  device_identifier text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patrol_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.patrol_templates(id) ON DELETE SET NULL,
  route_id uuid NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.patrol_schedules(id) ON DELETE SET NULL,
  device_id text,
  device_identifier text,
  guard_id uuid REFERENCES public.guards(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'awaiting_start', 'active', 'in_progress', 'late_start', 'late', 'delayed', 'completed', 'completed_late', 'missed', 'incomplete', 'cancelled', 'paused')),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  completed_required_count integer NOT NULL DEFAULT 0,
  total_required_count integer NOT NULL DEFAULT 0,
  progress numeric(5,2) NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patrol_session_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.patrol_sessions(id) ON DELETE CASCADE,
  route_checkpoint_id uuid REFERENCES public.patrol_route_checkpoints(id) ON DELETE SET NULL,
  checkpoint_id uuid NOT NULL REFERENCES public.checkpoints(id) ON DELETE RESTRICT,
  scheduled_order integer NOT NULL CHECK (scheduled_order > 0),
  scheduled_at timestamptz,
  scanned_at timestamptz,
  scan_log_id uuid REFERENCES public.scan_logs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'current', 'scanned', 'scanned_late', 'late', 'missed', 'skipped', 'out_of_order')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, checkpoint_id),
  UNIQUE (session_id, scheduled_order)
);

ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS patrol_template_id uuid REFERENCES public.patrol_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_route_id uuid REFERENCES public.patrol_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_schedule_id uuid REFERENCES public.patrol_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_session_id uuid REFERENCES public.patrol_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_match_status text NOT NULL DEFAULT 'unmatched'
    CHECK (patrol_match_status IN ('unmatched', 'matched', 'no_active_session', 'out_of_order', 'duplicate', 'manual')),
  ADD COLUMN IF NOT EXISTS patrol_validation_status text
    CHECK (patrol_validation_status IS NULL OR patrol_validation_status IN ('on_time', 'late', 'early', 'unexpected'));

CREATE INDEX IF NOT EXISTS idx_patrol_templates_company_site ON public.patrol_templates(company_id, site_id, status);
CREATE INDEX IF NOT EXISTS idx_patrol_routes_company_site ON public.patrol_routes(company_id, site_id, status);
CREATE INDEX IF NOT EXISTS idx_patrol_route_checkpoints_route_order ON public.patrol_route_checkpoints(route_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_patrol_schedules_company_next_run ON public.patrol_schedules(company_id, status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_patrol_sessions_company_status_time ON public.patrol_sessions(company_id, status, scheduled_start DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patrol_sessions_schedule_start_unique ON public.patrol_sessions(schedule_id, scheduled_start) WHERE schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patrol_sessions_device_time ON public.patrol_sessions(device_identifier, scheduled_start DESC) WHERE device_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patrol_session_checkpoints_session_status ON public.patrol_session_checkpoints(session_id, status, scheduled_order);
CREATE INDEX IF NOT EXISTS idx_scan_logs_patrol_session ON public.scan_logs(patrol_session_id, scanned_at DESC) WHERE patrol_session_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_patrol_templates_updated_at ON public.patrol_templates;
CREATE TRIGGER update_patrol_templates_updated_at BEFORE UPDATE ON public.patrol_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_patrol_routes_updated_at ON public.patrol_routes;
CREATE TRIGGER update_patrol_routes_updated_at BEFORE UPDATE ON public.patrol_routes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_patrol_schedules_updated_at ON public.patrol_schedules;
CREATE TRIGGER update_patrol_schedules_updated_at BEFORE UPDATE ON public.patrol_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_patrol_sessions_updated_at ON public.patrol_sessions;
CREATE TRIGGER update_patrol_sessions_updated_at BEFORE UPDATE ON public.patrol_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_patrol_session_checkpoints_updated_at ON public.patrol_session_checkpoints;
CREATE TRIGGER update_patrol_session_checkpoints_updated_at BEFORE UPDATE ON public.patrol_session_checkpoints
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.patrol_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_route_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_session_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY patrol_templates_read_company ON public.patrol_templates
FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_templates_manage_company ON public.patrol_templates
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_routes_read_company ON public.patrol_routes
FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_routes_manage_company ON public.patrol_routes
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_route_checkpoints_read_company ON public.patrol_route_checkpoints
FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_route_checkpoints_manage_company ON public.patrol_route_checkpoints
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_schedules_read_company ON public.patrol_schedules
FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_schedules_manage_company ON public.patrol_schedules
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_sessions_read_company ON public.patrol_sessions
FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_sessions_manage_company ON public.patrol_sessions
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_session_checkpoints_read_company ON public.patrol_session_checkpoints
FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY patrol_session_checkpoints_manage_company ON public.patrol_session_checkpoints
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

DO '
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_sessions;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
';

DO '
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_session_checkpoints;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
';

DO '
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_routes;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
';

NOTIFY pgrst, 'reload schema';
