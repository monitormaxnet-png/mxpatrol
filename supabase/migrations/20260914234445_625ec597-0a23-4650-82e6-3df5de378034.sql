-- Secure checkpoint NFC assignment: management chooses the checkpoint and authorized scanner device;
-- the physical device only scans the tag. Reuses the existing WhatsApp capture table as the
-- authoritative pending assignment store and adds a generic audit table for checkpoint changes.

ALTER TABLE public.checkpoints
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.checkpoints DROP CONSTRAINT IF EXISTS checkpoints_status_check;
ALTER TABLE public.checkpoints
  ADD CONSTRAINT checkpoints_status_check CHECK (status IN ('active', 'inactive'));

ALTER TABLE public.whatsapp_nfc_capture_requests
  ADD COLUMN IF NOT EXISTS checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_device_identifier text,
  ADD COLUMN IF NOT EXISTS operation_type text NOT NULL DEFAULT 'checkpoint_registration',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.whatsapp_nfc_capture_requests DROP CONSTRAINT IF EXISTS whatsapp_nfc_capture_requests_operation_type_check;
ALTER TABLE public.whatsapp_nfc_capture_requests
  ADD CONSTRAINT whatsapp_nfc_capture_requests_operation_type_check
  CHECK (operation_type IN ('checkpoint_registration', 'nfc_tag_replacement'));

CREATE INDEX IF NOT EXISTS whatsapp_nfc_capture_requests_device_waiting_idx
  ON public.whatsapp_nfc_capture_requests (company_id, expected_device_id, status, expires_at)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS whatsapp_nfc_capture_requests_checkpoint_idx
  ON public.whatsapp_nfc_capture_requests (company_id, checkpoint_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.checkpoint_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  action text NOT NULL,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  device_identifier text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.checkpoint_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkpoint_audit_logs_read_company ON public.checkpoint_audit_logs;
CREATE POLICY checkpoint_audit_logs_read_company
  ON public.checkpoint_audit_logs FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

DROP POLICY IF EXISTS checkpoint_audit_logs_manage_company ON public.checkpoint_audit_logs;
CREATE POLICY checkpoint_audit_logs_manage_company
  ON public.checkpoint_audit_logs FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  );

GRANT SELECT ON public.checkpoint_audit_logs TO authenticated;
GRANT ALL ON public.checkpoint_audit_logs TO service_role;