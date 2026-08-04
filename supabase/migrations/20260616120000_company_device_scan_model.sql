-- Move patrol scanning toward company/device ownership.
-- Guards are intentionally optional while the RG360 device-based demo is stabilized.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scan_logs'
      AND column_name = 'guard_id'
  ) THEN
    ALTER TABLE public.scan_logs ALTER COLUMN guard_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alerts'
      AND column_name = 'guard_id'
  ) THEN
    ALTER TABLE public.alerts ALTER COLUMN guard_id DROP NOT NULL;
  END IF;
END $$;

DROP POLICY IF EXISTS "Company users can view company scan logs" ON public.scan_logs;
DROP POLICY IF EXISTS "Company users can insert device scan logs" ON public.scan_logs;

DO $$
DECLARE
  guard_check text := '';
BEGIN
  IF to_regclass('public.scan_logs') IS NOT NULL
    AND to_regclass('public.devices') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'scan_logs'
        AND column_name = 'company_id'
    )
  THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'scan_logs'
        AND column_name = 'guard_id'
    ) THEN
      guard_check := 'AND guard_id IS NULL';
    END IF;

    EXECUTE $policy$
      CREATE POLICY "Company users can view company scan logs"
      ON public.scan_logs
      FOR SELECT
      TO authenticated
      USING (company_id = public.get_user_company_id(auth.uid()))
    $policy$;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'scan_logs'
        AND column_name = 'device_id'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "Company users can insert device scan logs"
        ON public.scan_logs
        FOR INSERT
        TO authenticated
        WITH CHECK (
          company_id = public.get_user_company_id(auth.uid())
          $policy$ || guard_check || $policy$
          AND device_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.devices
            WHERE devices.id = scan_logs.device_id
              AND devices.company_id = scan_logs.company_id
          )
        )
      $policy$;
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'scan_logs'
        AND column_name = 'device_identifier'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "Company users can insert device scan logs"
        ON public.scan_logs
        FOR INSERT
        TO authenticated
        WITH CHECK (
          company_id = public.get_user_company_id(auth.uid())
          $policy$ || guard_check || $policy$
          AND device_identifier IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.devices
            WHERE devices.device_identifier = scan_logs.device_identifier
              AND devices.company_id = scan_logs.company_id
          )
        )
      $policy$;
    END IF;
  END IF;
END $$;

DROP POLICY IF EXISTS "Company users can view company devices" ON public.devices;

DO $$
BEGIN
  IF to_regclass('public.devices') IS NOT NULL THEN
    EXECUTE $policy$
      CREATE POLICY "Company users can view company devices"
      ON public.devices
      FOR SELECT
      TO authenticated
      USING (company_id = public.get_user_company_id(auth.uid()))
    $policy$;
  END IF;
END $$;
