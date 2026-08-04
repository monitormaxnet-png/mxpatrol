-- Idempotent scan-to-patrol matching helpers.
-- Safe to call after every scan insert; unmatched scans remain valid scan_logs rows.

CREATE OR REPLACE FUNCTION public.recalculate_patrol_session_progress(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  required_total integer;
  required_done integer;
  next_status text;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(prc.is_required, true)),
    COUNT(*) FILTER (WHERE COALESCE(prc.is_required, true) AND psc.status IN ('scanned', 'scanned_late'))
  INTO required_total, required_done
  FROM public.patrol_session_checkpoints psc
  LEFT JOIN public.patrol_route_checkpoints prc ON prc.id = psc.route_checkpoint_id
  WHERE psc.session_id = p_session_id;

  required_total := COALESCE(required_total, 0);
  required_done := COALESCE(required_done, 0);

  SELECT CASE
    WHEN ps.status = 'cancelled' THEN 'cancelled'
    WHEN required_total > 0 AND required_done >= required_total THEN 'completed'
    WHEN required_done > 0 THEN 'active'
    WHEN ps.scheduled_end IS NOT NULL AND now() > ps.scheduled_end THEN 'missed'
    ELSE ps.status
  END
  INTO next_status
  FROM public.patrol_sessions ps
  WHERE ps.id = p_session_id;

  UPDATE public.patrol_sessions
  SET
    completed_required_count = required_done,
    total_required_count = required_total,
    progress = CASE WHEN required_total > 0 THEN ROUND((required_done::numeric / required_total::numeric) * 100, 2) ELSE 0 END,
    actual_start = COALESCE(actual_start, CASE WHEN required_done > 0 THEN now() ELSE NULL END),
    actual_end = CASE WHEN required_total > 0 AND required_done >= required_total THEN COALESCE(actual_end, now()) ELSE actual_end END,
    status = COALESCE(next_status, status),
    updated_at = now()
  WHERE id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_scan_to_patrol_session(p_scan_log_id uuid)
RETURNS TABLE(session_id uuid, session_checkpoint_id uuid, match_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scan_row record;
  session_row record;
  checkpoint_row record;
BEGIN
  SELECT *
  INTO scan_row
  FROM public.scan_logs
  WHERE id = p_scan_log_id;

  IF NOT FOUND OR scan_row.checkpoint_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'unmatched'::text;
    RETURN;
  END IF;

  SELECT ps.*
  INTO session_row
  FROM public.patrol_sessions ps
  JOIN public.patrol_session_checkpoints psc ON psc.session_id = ps.id
  WHERE ps.company_id = scan_row.company_id
    AND ps.status IN ('scheduled', 'awaiting_start', 'active', 'in_progress', 'late_start', 'late', 'delayed')
    AND psc.checkpoint_id = scan_row.checkpoint_id
    AND (ps.site_id IS NULL OR scan_row.site_id IS NULL OR ps.site_id = scan_row.site_id)
    AND (ps.device_identifier IS NULL OR scan_row.device_identifier IS NULL OR ps.device_identifier = scan_row.device_identifier)
    AND scan_row.scanned_at >= ps.scheduled_start - interval '30 minutes'
    AND (ps.scheduled_end IS NULL OR scan_row.scanned_at <= ps.scheduled_end + interval '30 minutes')
  ORDER BY
    CASE WHEN ps.device_identifier IS NOT NULL AND ps.device_identifier = scan_row.device_identifier THEN 0 ELSE 1 END,
    ABS(EXTRACT(EPOCH FROM (scan_row.scanned_at - ps.scheduled_start)))
  LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.scan_logs
    SET patrol_match_status = 'no_active_session'
    WHERE id = p_scan_log_id;

    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'no_active_session'::text;
    RETURN;
  END IF;

  SELECT psc.*
  INTO checkpoint_row
  FROM public.patrol_session_checkpoints psc
  WHERE psc.session_id = session_row.id
    AND psc.checkpoint_id = scan_row.checkpoint_id
  ORDER BY psc.scheduled_order
  LIMIT 1;

  IF checkpoint_row.status IN ('scanned', 'scanned_late') THEN
    UPDATE public.scan_logs
    SET
      patrol_template_id = session_row.template_id,
      patrol_route_id = session_row.route_id,
      patrol_schedule_id = session_row.schedule_id,
      patrol_session_id = session_row.id,
      patrol_match_status = 'duplicate'
    WHERE id = p_scan_log_id;

    RETURN QUERY SELECT session_row.id, checkpoint_row.id, 'duplicate'::text;
    RETURN;
  END IF;

  UPDATE public.patrol_session_checkpoints
  SET
    status = CASE WHEN checkpoint_row.scheduled_at IS NOT NULL AND scan_row.scanned_at > checkpoint_row.scheduled_at + interval '10 minutes' THEN 'scanned_late' ELSE 'scanned' END,
    scanned_at = scan_row.scanned_at,
    scan_log_id = p_scan_log_id,
    updated_at = now()
  WHERE id = checkpoint_row.id;

  UPDATE public.scan_logs
  SET
    patrol_template_id = session_row.template_id,
    patrol_route_id = session_row.route_id,
    patrol_schedule_id = session_row.schedule_id,
    patrol_session_id = session_row.id,
    patrol_match_status = 'matched',
    patrol_validation_status = CASE
      WHEN checkpoint_row.scheduled_at IS NOT NULL AND scan_row.scanned_at > checkpoint_row.scheduled_at + interval '10 minutes' THEN 'late'
      WHEN checkpoint_row.scheduled_at IS NOT NULL AND scan_row.scanned_at < checkpoint_row.scheduled_at - interval '10 minutes' THEN 'early'
      ELSE 'on_time'
    END
  WHERE id = p_scan_log_id;

  PERFORM public.recalculate_patrol_session_progress(session_row.id);

  RETURN QUERY SELECT session_row.id, checkpoint_row.id, 'matched'::text;
END;
$$;

NOTIFY pgrst, 'reload schema';
