-- Device-first live map support.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS current_gps_lat double precision,
  ADD COLUMN IF NOT EXISTS current_gps_lng double precision,
  ADD COLUMN IF NOT EXISTS current_gps_accuracy double precision,
  ADD COLUMN IF NOT EXISTS current_gps_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.scan_logs
SET user_id = scanned_by
WHERE user_id IS NULL AND scanned_by IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS devices_company_identifier_unique
  ON public.devices(company_id, device_identifier);

CREATE INDEX IF NOT EXISTS idx_devices_current_gps
  ON public.devices(company_id, status, current_gps_at DESC)
  WHERE current_gps_lat IS NOT NULL AND current_gps_lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scan_logs_device_time
  ON public.scan_logs(company_id, device_id, scanned_at DESC)
  WHERE device_id IS NOT NULL;

CREATE POLICY "Company members can register patrol devices"
  ON public.devices FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Company members can update their patrol device location"
  ON public.devices FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));
