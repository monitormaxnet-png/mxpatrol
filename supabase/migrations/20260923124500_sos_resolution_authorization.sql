-- Server-authorized SOS resolution metadata and stricter direct alert updates.
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_source text;

CREATE INDEX IF NOT EXISTS idx_alerts_active_sos
  ON public.alerts(company_id, site_id, created_at DESC)
  WHERE type = 'panic_button' AND COALESCE(is_read, false) = false;

DROP POLICY IF EXISTS "Company members can update alerts" ON public.alerts;

CREATE POLICY "Admins and supervisors can update alerts" ON public.alerts
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  )
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  );
