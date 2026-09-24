-- Ensure SOS alerts carry site context for saving, filtering, realtime dashboards, and maps.
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

UPDATE public.alerts a
SET site_id = c.site_id
FROM public.checkpoints c
WHERE a.site_id IS NULL
  AND a.checkpoint_id = c.id
  AND c.site_id IS NOT NULL;

UPDATE public.alerts a
SET site_id = ps.site_id
FROM public.patrol_sessions ps
WHERE a.site_id IS NULL
  AND a.session_id = ps.id
  AND ps.site_id IS NOT NULL;

UPDATE public.alerts a
SET site_id = d.site_id
FROM public.devices d
WHERE a.site_id IS NULL
  AND a.company_id = d.company_id
  AND a.device_identifier = d.device_identifier
  AND d.site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_company_site_created
  ON public.alerts(company_id, site_id, created_at DESC)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_active_sos_site
  ON public.alerts(company_id, site_id, created_at DESC)
  WHERE type = 'panic_button' AND COALESCE(is_read, false) = false;
