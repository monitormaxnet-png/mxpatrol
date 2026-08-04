-- Add site and device identity assignment to patrols and shifts.
-- company_id remains the tenant boundary; site_id separates branches; device_identifier ties planned work to an enrolled patrol device.

ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_identifier text;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_identifier text;

CREATE INDEX IF NOT EXISTS idx_patrols_company_site ON public.patrols(company_id, site_id);
CREATE INDEX IF NOT EXISTS idx_patrols_company_device_identifier ON public.patrols(company_id, device_identifier);
CREATE INDEX IF NOT EXISTS idx_shifts_company_site ON public.shifts(company_id, site_id);
CREATE INDEX IF NOT EXISTS idx_shifts_company_device_identifier ON public.shifts(company_id, device_identifier);

NOTIFY pgrst, 'reload schema';
