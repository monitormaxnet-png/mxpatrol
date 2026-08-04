-- Let realtime scan persistence proceed from company + device identifier.
-- Device presence is useful, but a failed devices upsert must not block Command Center scan feeds.

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
