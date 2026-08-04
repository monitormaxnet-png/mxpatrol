-- Report generation job tracking for scheduled, pending, running, completed, and failed reports.
CREATE TABLE IF NOT EXISTS public.report_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  report_id UUID REFERENCES public.ai_reports(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL DEFAULT 'daily',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('scheduled', 'pending', 'running', 'completed', 'failed')),
  date_range TEXT NOT NULL DEFAULT '7d' CHECK (date_range IN ('today', '7d', '30d')),
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_jobs_company_status_time
  ON public.report_jobs(company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_jobs_company_scheduled_for
  ON public.report_jobs(company_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

ALTER TABLE public.report_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can view report jobs" ON public.report_jobs;
CREATE POLICY "Company members can view report jobs" ON public.report_jobs
  FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

DROP POLICY IF EXISTS "Admins/supervisors can manage report jobs" ON public.report_jobs;
CREATE POLICY "Admins/supervisors can manage report jobs" ON public.report_jobs
  FOR ALL TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  )
  WITH CHECK (
    company_id = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.report_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS update_report_jobs_updated_at ON public.report_jobs;
CREATE TRIGGER update_report_jobs_updated_at
  BEFORE UPDATE ON public.report_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
