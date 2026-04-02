
CREATE TABLE public.cameras (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  name text NOT NULL,
  stream_url text NOT NULL,
  ip_address text,
  location text,
  location_lat double precision,
  location_lng double precision,
  camera_type text NOT NULL DEFAULT 'ip_camera',
  status text NOT NULL DEFAULT 'offline',
  is_recording boolean NOT NULL DEFAULT false,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.cameras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view cameras"
  ON public.cameras FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Admins can manage cameras"
  ON public.cameras FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.camera_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  camera_id uuid NOT NULL REFERENCES public.cameras(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  description text,
  thumbnail_url text,
  clip_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.camera_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view camera events"
  ON public.camera_events FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "System can insert camera events"
  ON public.camera_events FOR INSERT TO authenticated
  WITH CHECK (company_id = get_user_company_id(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.cameras;
ALTER PUBLICATION supabase_realtime ADD TABLE public.camera_events;
