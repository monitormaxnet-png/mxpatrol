-- Reinforce device-owned scan persistence for Command Center realtime feeds.
-- Scanner writes are company/device scoped; guard_id is optional.

ALTER TABLE public.scan_logs
  ALTER COLUMN guard_id DROP NOT NULL,
  ALTER COLUMN checkpoint_id DROP NOT NULL;

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
