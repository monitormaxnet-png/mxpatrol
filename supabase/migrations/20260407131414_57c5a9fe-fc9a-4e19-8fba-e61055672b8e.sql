
-- New enums
CREATE TYPE public.app_type AS ENUM ('admin_app', 'guard_device');
CREATE TYPE public.device_action AS ENUM ('enrolled', 'activated', 'suspended', 'revoked', 'replaced', 'heartbeat', 'command_sent', 'command_executed');
CREATE TYPE public.command_type AS ENUM ('lock_device', 'wipe_device', 'set_kiosk_mode', 'update_policy', 'install_app', 'uninstall_app');
CREATE TYPE public.command_status AS ENUM ('pending', 'sent', 'executed', 'failed');

-- Add app_type to devices
ALTER TABLE public.devices ADD COLUMN app_type public.app_type DEFAULT 'guard_device';
ALTER TABLE public.devices ADD COLUMN enrolled_via text;
ALTER TABLE public.devices ADD COLUMN compliance_score numeric DEFAULT 100;

-- Enrollment tokens table
CREATE TABLE public.enrollment_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  app_type public.app_type NOT NULL DEFAULT 'guard_device',
  token text NOT NULL UNIQUE,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  used_by_device_id uuid REFERENCES public.devices(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.enrollment_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage enrollment tokens"
  ON public.enrollment_tokens FOR ALL
  TO authenticated
  USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Company members can view enrollment tokens"
  ON public.enrollment_tokens FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

-- Device activity logs table
CREATE TABLE public.device_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action public.device_action NOT NULL,
  performed_by uuid REFERENCES auth.users(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.device_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view device activity logs"
  ON public.device_activity_logs FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Admins can insert device activity logs"
  ON public.device_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- Device heartbeats table
CREATE TABLE public.device_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  battery_level integer,
  is_online boolean DEFAULT true,
  ip_address text,
  app_version text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.device_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view heartbeats"
  ON public.device_heartbeats FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

-- Device commands table
CREATE TABLE public.device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  command_type public.command_type NOT NULL,
  status public.command_status NOT NULL DEFAULT 'pending',
  payload jsonb DEFAULT '{}'::jsonb,
  result jsonb,
  issued_by uuid REFERENCES auth.users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  executed_at timestamptz,
  retry_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view commands"
  ON public.device_commands FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Admins can manage commands"
  ON public.device_commands FOR ALL
  TO authenticated
  USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- Compliance scores table
CREATE TABLE public.compliance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  heartbeat_score numeric DEFAULT 100,
  policy_score numeric DEFAULT 100,
  patrol_score numeric DEFAULT 100,
  overall_score numeric DEFAULT 100,
  details jsonb DEFAULT '{}'::jsonb,
  scored_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compliance_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view compliance scores"
  ON public.compliance_scores FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

-- Enable realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_heartbeats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_activity_logs;

-- Indexes for performance
CREATE INDEX idx_enrollment_tokens_company ON public.enrollment_tokens(company_id);
CREATE INDEX idx_enrollment_tokens_token ON public.enrollment_tokens(token);
CREATE INDEX idx_device_activity_device ON public.device_activity_logs(device_id);
CREATE INDEX idx_device_heartbeats_device ON public.device_heartbeats(device_id);
CREATE INDEX idx_device_commands_device_status ON public.device_commands(device_id, status);
CREATE INDEX idx_compliance_scores_device ON public.compliance_scores(device_id);
