-- Multi-site support for MX Patrol.
-- company_id remains tenant isolation; site_id separates branches inside a company.

CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  gps_lat double precision,
  gps_lng double precision,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_company_id ON public.sites(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_company_name_unique ON public.sites(company_id, lower(name));

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view company sites" ON public.sites;
CREATE POLICY "Users can view company sites"
ON public.sites FOR SELECT
USING (
  company_id IN (SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid())
);

DROP POLICY IF EXISTS "Admins can manage company sites" ON public.sites;
CREATE POLICY "Admins can manage company sites"
ON public.sites FOR ALL
USING (
  company_id IN (SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid())
)
WITH CHECK (
  company_id IN (SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid())
);

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE public.checkpoints ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE public.scan_logs ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

DO $patrol_sessions_block$
BEGIN
  IF to_regclass('public.patrol_sessions') IS NOT NULL THEN
    ALTER TABLE public.patrol_sessions ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_patrol_sessions_company_site ON public.patrol_sessions(company_id, site_id);
  END IF;
END
$patrol_sessions_block$;

CREATE INDEX IF NOT EXISTS idx_devices_company_site ON public.devices(company_id, site_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_company_site ON public.checkpoints(company_id, site_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_company_site_time ON public.scan_logs(company_id, site_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_company_site ON public.alerts(company_id, site_id);

UPDATE public.scan_logs sl
SET site_id = cp.site_id
FROM public.checkpoints cp
WHERE sl.company_id = cp.company_id
  AND sl.checkpoint_id = cp.id
  AND sl.site_id IS NULL
  AND cp.site_id IS NOT NULL;

UPDATE public.scan_logs sl
SET site_id = d.site_id
FROM public.devices d
WHERE sl.company_id = d.company_id
  AND sl.site_id IS NULL
  AND d.site_id IS NOT NULL
  AND (
    sl.device_identifier IS NOT DISTINCT FROM d.device_identifier
    OR sl.device_id IS NOT DISTINCT FROM d.device_identifier
    OR sl.device_id IS NOT DISTINCT FROM d.id::text
  );

CREATE OR REPLACE FUNCTION public.assign_scan_log_site_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $scan_site_fn$
DECLARE
  v_site_id uuid;
BEGIN
  IF NEW.site_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.checkpoint_id IS NOT NULL THEN
    SELECT site_id INTO v_site_id
    FROM public.checkpoints
    WHERE id = NEW.checkpoint_id
      AND company_id = NEW.company_id;
  END IF;

  IF v_site_id IS NULL THEN
    SELECT site_id INTO v_site_id
    FROM public.devices
    WHERE company_id = NEW.company_id
      AND site_id IS NOT NULL
      AND (
        device_identifier IS NOT DISTINCT FROM NEW.device_identifier
        OR device_identifier IS NOT DISTINCT FROM NEW.device_id
        OR id::text IS NOT DISTINCT FROM NEW.device_id
      )
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  NEW.site_id := v_site_id;
  RETURN NEW;
END;
$scan_site_fn$;

DROP TRIGGER IF EXISTS trg_assign_scan_log_site_id ON public.scan_logs;
CREATE TRIGGER trg_assign_scan_log_site_id
BEFORE INSERT OR UPDATE OF checkpoint_id, device_id, device_identifier, site_id
ON public.scan_logs
FOR EACH ROW
EXECUTE FUNCTION public.assign_scan_log_site_id();

CREATE OR REPLACE FUNCTION public.assign_alert_site_id_from_scan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $alert_site_fn$
DECLARE
  v_site_id uuid;
BEGIN
  IF NEW.site_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.scan_log_id IS NOT NULL THEN
    SELECT site_id INTO v_site_id
    FROM public.scan_logs
    WHERE id = NEW.scan_log_id
      AND company_id = NEW.company_id;
  END IF;

  NEW.site_id := v_site_id;
  RETURN NEW;
END;
$alert_site_fn$;

DO $alert_trigger_block$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'alerts' AND column_name = 'scan_log_id') THEN
    DROP TRIGGER IF EXISTS trg_assign_alert_site_id_from_scan ON public.alerts;
    CREATE TRIGGER trg_assign_alert_site_id_from_scan
    BEFORE INSERT OR UPDATE OF scan_log_id, site_id
    ON public.alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_alert_site_id_from_scan();
  ELSE
    RAISE NOTICE 'alerts.scan_log_id does not exist; alert site inheritance trigger was not created';
  END IF;
END
$alert_trigger_block$;

NOTIFY pgrst, 'reload schema';
