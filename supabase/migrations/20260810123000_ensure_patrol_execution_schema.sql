-- Production repair for the scheduled patrol execution schema.
-- Safe to run more than once; it creates/repairs the tables used by Session Logs.

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
  status text NOT NULL DEFAULT 'active',
  expected_duration_minutes integer NOT NULL DEFAULT 60,
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
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patrol_route_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES public.checkpoints(id) ON DELETE RESTRICT,
  sequence_order integer NOT NULL,
  expected_arrival_offset_minutes integer,
  expected_offset_minutes integer,
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
  description text,
  frequency text NOT NULL DEFAULT 'daily',
  frequency_type text NOT NULL DEFAULT 'daily',
  interval_value integer NOT NULL DEFAULT 1,
  start_time time,
  end_time time,
  days_of_week integer[] NOT NULL DEFAULT '{}'::integer[],
  timezone text NOT NULL DEFAULT 'Africa/Gaborone',
  status text NOT NULL DEFAULT 'active',
  next_run_at timestamptz,
  active_from timestamptz DEFAULT now(),
  active_until timestamptz,
  grace_start_minutes integer NOT NULL DEFAULT 10,
  grace_completion_minutes integer NOT NULL DEFAULT 40,
  expected_duration_minutes integer NOT NULL DEFAULT 60,
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
  status text NOT NULL DEFAULT 'scheduled',
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  completed_required_count integer NOT NULL DEFAULT 0,
  total_required_count integer NOT NULL DEFAULT 0,
  checkpoint_completed integer NOT NULL DEFAULT 0,
  checkpoint_total integer NOT NULL DEFAULT 0,
  progress numeric(5,2) NOT NULL DEFAULT 0,
  progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  finalized_at timestamptz,
  missed_reason text,
  incident_count integer NOT NULL DEFAULT 0,
  open_incident_count integer NOT NULL DEFAULT 0,
  critical_incident_count integer NOT NULL DEFAULT 0,
  sos_count integer NOT NULL DEFAULT 0,
  unacknowledged_sos_count integer NOT NULL DEFAULT 0,
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
  checkpoint_name_snapshot text,
  scheduled_order integer NOT NULL,
  required boolean NOT NULL DEFAULT true,
  scheduled_at timestamptz,
  scanned_at timestamptz,
  scan_log_id uuid REFERENCES public.scan_logs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  gps_lat numeric,
  gps_lng numeric,
  gps_accuracy numeric,
  audit_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, checkpoint_id),
  UNIQUE (session_id, scheduled_order)
);

ALTER TABLE public.patrol_schedules
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS expected_duration_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE public.patrol_sessions
  ADD COLUMN IF NOT EXISTS checkpoint_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkpoint_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS missed_reason text,
  ADD COLUMN IF NOT EXISTS incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS critical_incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sos_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unacknowledged_sos_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.patrol_session_checkpoints
  ADD COLUMN IF NOT EXISTS checkpoint_name_snapshot text,
  ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gps_lat numeric,
  ADD COLUMN IF NOT EXISTS gps_lng numeric,
  ADD COLUMN IF NOT EXISTS gps_accuracy numeric,
  ADD COLUMN IF NOT EXISTS audit_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS patrol_template_id uuid REFERENCES public.patrol_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_route_id uuid REFERENCES public.patrol_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_schedule_id uuid REFERENCES public.patrol_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_session_id uuid REFERENCES public.patrol_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patrol_match_status text NOT NULL DEFAULT 'unmatched',
  ADD COLUMN IF NOT EXISTS patrol_validation_status text;

CREATE INDEX IF NOT EXISTS idx_patrol_templates_company_site ON public.patrol_templates(company_id, site_id, status);
CREATE INDEX IF NOT EXISTS idx_patrol_routes_company_site ON public.patrol_routes(company_id, site_id, status);
CREATE INDEX IF NOT EXISTS idx_patrol_route_checkpoints_route_order ON public.patrol_route_checkpoints(route_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_patrol_schedules_company_next_run ON public.patrol_schedules(company_id, status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_patrol_sessions_company_status_time ON public.patrol_sessions(company_id, status, scheduled_start DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_sessions_company_site_time ON public.patrol_sessions(company_id, site_id, scheduled_start DESC);
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patrol_sessions' AND policyname = 'patrol_sessions_read_company') THEN
    CREATE POLICY patrol_sessions_read_company ON public.patrol_sessions
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patrol_session_checkpoints' AND policyname = 'patrol_session_checkpoints_read_company') THEN
    CREATE POLICY patrol_session_checkpoints_read_company ON public.patrol_session_checkpoints
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patrol_templates' AND policyname = 'patrol_templates_read_company') THEN
    CREATE POLICY patrol_templates_read_company ON public.patrol_templates
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patrol_routes' AND policyname = 'patrol_routes_read_company') THEN
    CREATE POLICY patrol_routes_read_company ON public.patrol_routes
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patrol_route_checkpoints' AND policyname = 'patrol_route_checkpoints_read_company') THEN
    CREATE POLICY patrol_route_checkpoints_read_company ON public.patrol_route_checkpoints
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patrol_schedules' AND policyname = 'patrol_schedules_read_company') THEN
    CREATE POLICY patrol_schedules_read_company ON public.patrol_schedules
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_sessions;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_session_checkpoints;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_routes;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_schedules;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
