ALTER TABLE public.scan_logs DROP CONSTRAINT IF EXISTS scan_logs_patrol_match_status_check;
ALTER TABLE public.scan_logs ADD CONSTRAINT scan_logs_patrol_match_status_check
  CHECK (patrol_match_status = ANY (ARRAY['unmatched','matched','no_active_session','wrong_patrol','out_of_order','duplicate','manual']));

ALTER TABLE public.scan_logs DROP CONSTRAINT IF EXISTS scan_logs_patrol_validation_status_check;
ALTER TABLE public.scan_logs ADD CONSTRAINT scan_logs_patrol_validation_status_check
  CHECK (patrol_validation_status IS NULL OR patrol_validation_status = ANY (ARRAY['on_time','late','early','unexpected','unscheduled','wrong_patrol','out_of_order']));