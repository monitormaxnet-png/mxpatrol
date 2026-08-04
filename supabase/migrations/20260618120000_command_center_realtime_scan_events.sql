-- Command Center realtime scan events.
-- Scans are company/device owned; guard_id remains optional.

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
  ALTER COLUMN guard_id DROP NOT NULL,
  ALTER COLUMN checkpoint_id DROP NOT NULL,
  ADD CONSTRAINT scan_logs_tag_status_check
    CHECK (tag_status IN ('registered', 'unregistered', 'pending_registration', 'rejected'));

UPDATE public.scan_logs
SET tag_status = 'unregistered'
WHERE checkpoint_id IS NULL
  AND tag_status = 'pending_registration';

CREATE INDEX IF NOT EXISTS idx_scan_logs_company_device_identifier_time
  ON public.scan_logs(company_id, device_identifier, scanned_at DESC)
  WHERE device_identifier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scan_logs_company_unregistered
  ON public.scan_logs(company_id, scanned_at DESC)
  WHERE checkpoint_id IS NULL AND tag_status IN ('unregistered', 'pending_registration');

CREATE INDEX IF NOT EXISTS idx_pending_nfc_tags_company_pending_time
  ON public.pending_nfc_tags(company_id, status, last_seen_at DESC);

DROP POLICY IF EXISTS "Company users can view company scan logs" ON public.scan_logs;
DROP POLICY IF EXISTS "Company members can view scan logs" ON public.scan_logs;
CREATE POLICY "Company users can view company scan logs"
  ON public.scan_logs
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

DROP POLICY IF EXISTS "Guards can insert scan logs" ON public.scan_logs;
DROP POLICY IF EXISTS "Company members can insert valid scan logs" ON public.scan_logs;
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
    AND EXISTS (
      SELECT 1
      FROM public.devices
      WHERE devices.company_id = scan_logs.company_id
        AND (
          devices.device_identifier = scan_logs.device_identifier
          OR devices.device_identifier = scan_logs.device_id
          OR devices.id::text = scan_logs.device_id
        )
    )
  );

DROP POLICY IF EXISTS "Company members can view pending NFC tags" ON public.pending_nfc_tags;
DROP POLICY IF EXISTS "Company users can view company pending NFC tags" ON public.pending_nfc_tags;
CREATE POLICY "Company users can view company pending NFC tags"
  ON public.pending_nfc_tags
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

DROP POLICY IF EXISTS "Company members can create pending NFC tags" ON public.pending_nfc_tags;
DROP POLICY IF EXISTS "Company users can create company pending NFC tags" ON public.pending_nfc_tags;
CREATE POLICY "Company users can create company pending NFC tags"
  ON public.pending_nfc_tags
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (
      device_identifier IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.devices
        WHERE devices.company_id = pending_nfc_tags.company_id
          AND (
            devices.device_identifier = pending_nfc_tags.device_identifier
            OR devices.device_identifier = pending_nfc_tags.device_id
            OR devices.id::text = pending_nfc_tags.device_id
          )
      )
    )
  );

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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pending_nfc_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_nfc_tags;
  END IF;
END
$$;
