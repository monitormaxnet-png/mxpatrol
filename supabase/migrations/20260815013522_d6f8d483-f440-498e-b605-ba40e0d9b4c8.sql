-- 1. Authorized WhatsApp numbers
CREATE TABLE public.whatsapp_authorized_numbers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guard_id uuid REFERENCES public.guards(id) ON DELETE SET NULL,
  phone text,
  display_name text,
  status text NOT NULL DEFAULT 'pending',
  link_code text,
  link_code_expires_at timestamp with time zone,
  allowed_site_ids uuid[] NOT NULL DEFAULT '{}',
  authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_authorized_numbers_phone_key
  ON public.whatsapp_authorized_numbers (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX whatsapp_authorized_numbers_link_code_key
  ON public.whatsapp_authorized_numbers (link_code) WHERE link_code IS NOT NULL;
CREATE INDEX whatsapp_authorized_numbers_company_idx
  ON public.whatsapp_authorized_numbers (company_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_authorized_numbers TO authenticated;
GRANT ALL ON public.whatsapp_authorized_numbers TO service_role;
ALTER TABLE public.whatsapp_authorized_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view company whatsapp numbers"
  ON public.whatsapp_authorized_numbers FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      company_id = public.get_user_company_id(auth.uid())
      AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    )
  );

CREATE POLICY "Managers add company whatsapp numbers"
  ON public.whatsapp_authorized_numbers FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  );

CREATE POLICY "Managers update company whatsapp numbers"
  ON public.whatsapp_authorized_numbers FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      company_id = public.get_user_company_id(auth.uid())
      AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      company_id = public.get_user_company_id(auth.uid())
      AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    )
  );

CREATE POLICY "Admins remove company whatsapp numbers"
  ON public.whatsapp_authorized_numbers FOR DELETE TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE TRIGGER trg_whatsapp_authorized_numbers_updated_at
  BEFORE UPDATE ON public.whatsapp_authorized_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Conversation session state
CREATE TABLE public.whatsapp_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  authorized_number_id uuid REFERENCES public.whatsapp_authorized_numbers(id) ON DELETE CASCADE,
  current_flow text,
  current_step text,
  temporary_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  current_site_name text,
  site_scope text NOT NULL DEFAULT 'single',
  last_menu text,
  last_inbound_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_sessions_phone_key ON public.whatsapp_sessions (phone);

GRANT SELECT ON public.whatsapp_sessions TO authenticated;
GRANT ALL ON public.whatsapp_sessions TO service_role;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view company whatsapp sessions"
  ON public.whatsapp_sessions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      company_id = public.get_user_company_id(auth.uid())
      AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    )
  );

CREATE TRIGGER trg_whatsapp_sessions_updated_at
  BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Pending NFC capture requests started from WhatsApp
CREATE TABLE public.whatsapp_nfc_capture_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
  phone text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purpose text NOT NULL DEFAULT 'create_checkpoint',
  checkpoint_name text,
  status text NOT NULL DEFAULT 'waiting',
  nfc_tag_id text,
  device_identifier text,
  gps_lat double precision,
  gps_lng double precision,
  captured_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '10 minutes'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_nfc_capture_requests_pending_idx
  ON public.whatsapp_nfc_capture_requests (company_id, status, expires_at);

GRANT SELECT ON public.whatsapp_nfc_capture_requests TO authenticated;
GRANT ALL ON public.whatsapp_nfc_capture_requests TO service_role;
ALTER TABLE public.whatsapp_nfc_capture_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view company nfc capture requests"
  ON public.whatsapp_nfc_capture_requests FOR SELECT TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  );

CREATE TRIGGER trg_whatsapp_nfc_capture_requests_updated_at
  BEFORE UPDATE ON public.whatsapp_nfc_capture_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();