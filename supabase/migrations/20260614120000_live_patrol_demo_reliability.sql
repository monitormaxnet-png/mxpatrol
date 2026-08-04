-- Live patrol, map, and reporting reliability.

UPDATE public.scan_logs
SET device_identifier = device_id
WHERE device_identifier IS NULL AND device_id IS NOT NULL;

UPDATE public.scan_logs
SET device_id = device_identifier
WHERE device_id IS NULL AND device_identifier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scan_logs_company_scanned_at
  ON public.scan_logs(company_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_logs_company_checkpoint_time
  ON public.scan_logs(company_id, checkpoint_id, scanned_at DESC)
  WHERE checkpoint_id IS NOT NULL;

DROP POLICY IF EXISTS "Guards can insert scan logs" ON public.scan_logs;
DROP POLICY IF EXISTS "Company members can insert valid scan logs" ON public.scan_logs;
CREATE POLICY "Company members can insert valid scan logs"
  ON public.scan_logs FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (scanned_by IS NULL OR scanned_by = auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
    AND (
      guard_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.guards
        WHERE guards.id = scan_logs.guard_id
          AND guards.company_id = public.get_user_company_id(auth.uid())
      )
    )
    AND (
      checkpoint_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.checkpoints
        WHERE checkpoints.id = scan_logs.checkpoint_id
          AND checkpoints.company_id = public.get_user_company_id(auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Company members can update own scan GPS" ON public.scan_logs;
CREATE POLICY "Company members can update own scan GPS"
  ON public.scan_logs FOR UPDATE TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND (
      scanned_by = auth.uid()
      OR user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  )
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

DROP POLICY IF EXISTS "Company members can update their patrol device location" ON public.devices;
CREATE POLICY "Company members can update their patrol device location"
  ON public.devices FOR UPDATE TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND (
      user_id IS NULL
      OR user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  )
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
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
      AND tablename = 'devices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
  END IF;
END
$$;
