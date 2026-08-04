-- NFC workflow redesign: record every tag scan and route unknown tags to admin approval.

CREATE TABLE IF NOT EXISTS public.pending_nfc_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tag_uid text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy double precision,
  device_id text,
  device_identifier text,
  device_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  scan_log_id uuid,
  alert_id uuid REFERENCES public.alerts(id) ON DELETE SET NULL,
  checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, tag_uid)
);

CREATE TABLE IF NOT EXISTS public.nfc_tag_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pending_tag_id uuid REFERENCES public.pending_nfc_tags(id) ON DELETE SET NULL,
  scan_log_id uuid REFERENCES public.scan_logs(id) ON DELETE SET NULL,
  checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  tag_uid text NOT NULL,
  action text NOT NULL CHECK (action IN ('scan_recorded', 'pending_created', 'approved', 'rejected')),
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  gps_lat double precision,
  gps_lng double precision,
  device_id text,
  device_identifier text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scan_logs
  ALTER COLUMN guard_id DROP NOT NULL,
  ALTER COLUMN checkpoint_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS tag_uid text,
  ADD COLUMN IF NOT EXISTS tag_status text NOT NULL DEFAULT 'registered'
    CHECK (tag_status IN ('registered', 'pending_registration', 'rejected')),
  ADD COLUMN IF NOT EXISTS gps_accuracy double precision,
  ADD COLUMN IF NOT EXISTS device_identifier text,
  ADD COLUMN IF NOT EXISTS device_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scanned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.scan_logs
SET tag_status = 'registered'
WHERE tag_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_scan_logs_tag_uid ON public.scan_logs(tag_uid);
CREATE INDEX IF NOT EXISTS idx_scan_logs_tag_status ON public.scan_logs(tag_status);
CREATE INDEX IF NOT EXISTS idx_pending_nfc_tags_company_status ON public.pending_nfc_tags(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfc_tag_audit_company_tag ON public.nfc_tag_audit_logs(company_id, tag_uid, created_at DESC);

ALTER TABLE public.pending_nfc_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfc_tag_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view pending NFC tags"
  ON public.pending_nfc_tags FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Company members can create pending NFC tags"
  ON public.pending_nfc_tags FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Admins/supervisors can update pending NFC tags"
  ON public.pending_nfc_tags FOR UPDATE TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  );

CREATE POLICY "Company members can view NFC tag audit logs"
  ON public.nfc_tag_audit_logs FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Company members can create NFC tag audit logs"
  ON public.nfc_tag_audit_logs FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

DROP TRIGGER IF EXISTS update_pending_nfc_tags_updated_at ON public.pending_nfc_tags;
CREATE TRIGGER update_pending_nfc_tags_updated_at
  BEFORE UPDATE ON public.pending_nfc_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_nfc_tags;
ALTER PUBLICATION supabase_realtime ADD TABLE public.nfc_tag_audit_logs;
