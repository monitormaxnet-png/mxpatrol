-- Align the live Supabase schema with the RG360 scanner payload.
-- This fixes:
--   - scan_logs insert failure when device_metadata is absent from PostgREST schema
--   - devices upsert failure when company_id/device_identifier has no unique target

ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS tag_uid text,
  ADD COLUMN IF NOT EXISTS tag_status text DEFAULT 'registered',
  ADD COLUMN IF NOT EXISTS gps_accuracy numeric,
  ADD COLUMN IF NOT EXISTS scanned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS device_identifier text,
  ADD COLUMN IF NOT EXISTS device_metadata jsonb DEFAULT '{}'::jsonb,
  ALTER COLUMN guard_id DROP NOT NULL,
  ALTER COLUMN checkpoint_id DROP NOT NULL;

DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.scan_logs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tag_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.scan_logs DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;
END
$$;

ALTER TABLE public.scan_logs
  ADD CONSTRAINT scan_logs_tag_status_check
    CHECK (tag_status IN ('registered', 'unregistered', 'pending_registration', 'rejected'));

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS device_identifier text,
  ADD COLUMN IF NOT EXISTS current_gps_lat numeric,
  ADD COLUMN IF NOT EXISTS current_gps_lng numeric,
  ADD COLUMN IF NOT EXISTS current_gps_accuracy numeric,
  ADD COLUMN IF NOT EXISTS current_gps_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

DELETE FROM public.devices d
USING public.devices duplicate
WHERE d.ctid < duplicate.ctid
  AND d.company_id = duplicate.company_id
  AND d.device_identifier IS NOT DISTINCT FROM duplicate.device_identifier
  AND d.device_identifier IS NOT NULL;

DROP INDEX IF EXISTS public.devices_company_identifier_unique;
CREATE UNIQUE INDEX IF NOT EXISTS devices_company_identifier_unique
  ON public.devices(company_id, device_identifier);

CREATE INDEX IF NOT EXISTS idx_scan_logs_company_device_identifier_time
  ON public.scan_logs(company_id, device_identifier, scanned_at DESC)
  WHERE device_identifier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scan_logs_company_unregistered
  ON public.scan_logs(company_id, scanned_at DESC)
  WHERE checkpoint_id IS NULL AND tag_status IN ('unregistered', 'pending_registration');

DROP POLICY IF EXISTS "Company users can insert device scan logs" ON public.scan_logs;
CREATE POLICY "Company users can insert device scan logs"
  ON public.scan_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (guard_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.guards
      WHERE guards.id = scan_logs.guard_id
        AND guards.company_id = scan_logs.company_id
    ))
    AND (checkpoint_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.checkpoints
      WHERE checkpoints.id = scan_logs.checkpoint_id
        AND checkpoints.company_id = scan_logs.company_id
    ))
    AND (
      device_identifier IS NOT NULL
      OR device_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Company members can register patrol devices" ON public.devices;
CREATE POLICY "Company members can register patrol devices"
  ON public.devices
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

DROP POLICY IF EXISTS "Company members can update their patrol device location" ON public.devices;
CREATE POLICY "Company members can update their patrol device location"
  ON public.devices
  FOR UPDATE
  TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scan_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_logs;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
