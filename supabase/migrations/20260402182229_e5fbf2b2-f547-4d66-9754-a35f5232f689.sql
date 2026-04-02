
ALTER TABLE public.scan_logs
  ADD COLUMN is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN manual_scan_reason text;
