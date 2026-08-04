CREATE OR REPLACE FUNCTION public.match_scan_to_patrol_session(p_scan_log_id uuid)
RETURNS TABLE(
  session_id uuid,
  session_checkpoint_id uuid,
  match_status text,
  code text,
  session_status text,
  patrol_name text,
  schedule_id uuid,
  completed integer,
  required integer,
  progress_percent numeric,
  next_checkpoint_id uuid,
  next_checkpoint_name text,
  selection_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scan_row record;
  session_row record;
  checkpoint_row record;
  recent_row record;
  reason text;
  was_late boolean := false;
  v_next_id uuid;
  v_next_name text;
  v_final record;
BEGIN
  SELECT * INTO scan_row FROM public.scan_logs WHERE id = p_scan_log_id;

  IF NOT FOUND OR scan_row.checkpoint_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'unmatched'::text, 'UNREGISTERED_CHECKPOINT'::text,
      NULL::text, NULL::text, NULL::uuid, 0, 0, 0::numeric, NULL::uuid, NULL::text, 'no_checkpoint'::text;
    RETURN;
  END IF;

  -- Repeat tap guard: the same checkpoint was already accepted into a patrol very recently.
  SELECT sl.patrol_session_id INTO recent_row
  FROM public.scan_logs sl
  WHERE sl.id <> p_scan_log_id
    AND sl.company_id = scan_row.company_id
    AND sl.checkpoint_id = scan_row.checkpoint_id
    AND sl.patrol_session_id IS NOT NULL
    AND sl.patrol_match_status = 'matched'
    AND COALESCE(sl.device_identifier, '') = COALESCE(scan_row.device_identifier, '')
    AND sl.scanned_at >= scan_row.scanned_at - interval '10 minutes'
  ORDER BY sl.scanned_at DESC
  LIMIT 1;

  IF recent_row.patrol_session_id IS NOT NULL THEN
    UPDATE public.scan_logs
    SET patrol_session_id = recent_row.patrol_session_id,
        patrol_match_status = 'duplicate'
    WHERE id = p_scan_log_id;

    SELECT * INTO v_final FROM public.patrol_sessions WHERE id = recent_row.patrol_session_id;

    RETURN QUERY SELECT recent_row.patrol_session_id, NULL::uuid, 'duplicate'::text, 'CHECKPOINT_ALREADY_SCANNED'::text,
      v_final.status, NULL::text, v_final.schedule_id,
      COALESCE(v_final.checkpoint_completed,0), COALESCE(v_final.checkpoint_total,0),
      COALESCE(v_final.progress_percent,0), NULL::uuid, NULL::text, 'recent_duplicate_tap'::text;
    RETURN;
  END IF;

  SELECT ps.*,
    CASE
      WHEN ps.status IN ('active','in_progress')
       AND ps.device_identifier IS NOT NULL
       AND ps.device_identifier = scan_row.device_identifier THEN 'active_session_for_device'
      WHEN scan_row.scanned_at >= ps.scheduled_start
       AND (ps.scheduled_end IS NULL OR scan_row.scanned_at <= ps.scheduled_end) THEN 'occurrence_window_contains_scan'
      WHEN scan_row.scanned_at < ps.scheduled_start THEN 'early_start_tolerance'
      ELSE 'completion_grace'
    END AS reason
  INTO session_row
  FROM public.patrol_sessions ps
  WHERE ps.company_id = scan_row.company_id
    AND ps.status IN ('scheduled','awaiting_start','active','in_progress','late_start','late','delayed','incomplete')
    AND (ps.site_id IS NULL OR scan_row.site_id IS NULL OR ps.site_id = scan_row.site_id)
    AND (ps.device_identifier IS NULL OR scan_row.device_identifier IS NULL OR ps.device_identifier = scan_row.device_identifier)
    AND scan_row.scanned_at >= ps.scheduled_start - interval '15 minutes'
    AND (ps.scheduled_end IS NULL OR scan_row.scanned_at <= ps.scheduled_end + interval '15 minutes')
    AND EXISTS (
      SELECT 1 FROM public.patrol_session_checkpoints psc
      WHERE psc.session_id = ps.id AND psc.checkpoint_id = scan_row.checkpoint_id
    )
  ORDER BY
    CASE WHEN ps.status IN ('active','in_progress')
          AND ps.device_identifier IS NOT NULL
          AND ps.device_identifier = scan_row.device_identifier THEN 0 ELSE 1 END,
    CASE WHEN scan_row.scanned_at >= ps.scheduled_start
          AND (ps.scheduled_end IS NULL OR scan_row.scanned_at <= ps.scheduled_end) THEN 0 ELSE 1 END,
    CASE WHEN ps.device_identifier IS NOT NULL AND ps.device_identifier = scan_row.device_identifier THEN 0 ELSE 1 END,
    ABS(EXTRACT(EPOCH FROM (scan_row.scanned_at - ps.scheduled_start))),
    ps.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.scan_logs
    SET patrol_match_status = 'no_active_session'
    WHERE id = p_scan_log_id;

    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'no_active_session'::text, 'NO_ACTIVE_PATROL'::text,
      NULL::text, NULL::text, NULL::uuid, 0, 0, 0::numeric, NULL::uuid, NULL::text, 'no_candidate'::text;
    RETURN;
  END IF;

  reason := session_row.reason;

  SELECT psc.* INTO checkpoint_row
  FROM public.patrol_session_checkpoints psc
  WHERE psc.session_id = session_row.id
    AND psc.checkpoint_id = scan_row.checkpoint_id
  ORDER BY psc.scheduled_order
  LIMIT 1;

  SELECT psc.checkpoint_id, c.name INTO v_next_id, v_next_name
  FROM public.patrol_session_checkpoints psc
  JOIN public.checkpoints c ON c.id = psc.checkpoint_id
  WHERE psc.session_id = session_row.id
    AND psc.status NOT IN ('scanned','scanned_late')
  ORDER BY psc.scheduled_order
  LIMIT 1;

  IF checkpoint_row.status IN ('scanned','scanned_late') THEN
    UPDATE public.scan_logs
    SET patrol_template_id = session_row.template_id,
        patrol_route_id = session_row.route_id,
        patrol_schedule_id = session_row.schedule_id,
        patrol_session_id = session_row.id,
        patrol_match_status = 'duplicate'
    WHERE id = p_scan_log_id;

    SELECT * INTO v_final FROM public.patrol_sessions WHERE id = session_row.id;

    RETURN QUERY SELECT session_row.id, checkpoint_row.id, 'duplicate'::text, 'CHECKPOINT_ALREADY_SCANNED'::text,
      v_final.status, NULL::text, session_row.schedule_id,
      COALESCE(v_final.checkpoint_completed,0), COALESCE(v_final.checkpoint_total,0),
      COALESCE(v_final.progress_percent,0), v_next_id, v_next_name, reason;
    RETURN;
  END IF;

  was_late := checkpoint_row.scheduled_at IS NOT NULL
    AND scan_row.scanned_at > checkpoint_row.scheduled_at + interval '10 minutes';

  UPDATE public.patrol_session_checkpoints
  SET status = CASE WHEN was_late THEN 'scanned_late' ELSE 'scanned' END,
      scanned_at = scan_row.scanned_at,
      scan_log_id = p_scan_log_id,
      updated_at = now()
  WHERE id = checkpoint_row.id;

  UPDATE public.patrol_sessions
  SET status = CASE WHEN status IN ('scheduled','awaiting_start','late_start','late','delayed') THEN 'active' ELSE status END,
      actual_start = COALESCE(actual_start, scan_row.scanned_at, now()),
      device_identifier = COALESCE(device_identifier, scan_row.device_identifier),
      device_id = COALESCE(device_id, scan_row.device_identifier),
      site_id = COALESCE(site_id, scan_row.site_id),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('match_selection_reason', reason, 'auto_started_by_scan', p_scan_log_id),
      updated_at = now()
  WHERE id = session_row.id;

  UPDATE public.scan_logs
  SET patrol_template_id = session_row.template_id,
      patrol_route_id = session_row.route_id,
      patrol_schedule_id = session_row.schedule_id,
      patrol_session_id = session_row.id,
      patrol_match_status = 'matched',
      patrol_validation_status = CASE
        WHEN was_late THEN 'late'
        WHEN scan_row.scanned_at < session_row.scheduled_start THEN 'early'
        ELSE 'on_time'
      END
  WHERE id = p_scan_log_id;

  PERFORM public.recalculate_patrol_session_progress(session_row.id);

  SELECT * INTO v_final FROM public.patrol_sessions WHERE id = session_row.id;

  SELECT psc.checkpoint_id, c.name INTO v_next_id, v_next_name
  FROM public.patrol_session_checkpoints psc
  JOIN public.checkpoints c ON c.id = psc.checkpoint_id
  WHERE psc.session_id = session_row.id
    AND psc.status NOT IN ('scanned','scanned_late')
  ORDER BY psc.scheduled_order
  LIMIT 1;

  RETURN QUERY SELECT
    session_row.id,
    checkpoint_row.id,
    'matched'::text,
    CASE
      WHEN v_final.status = 'completed' THEN 'PATROL_COMPLETED'
      WHEN COALESCE(v_final.checkpoint_completed,0) <= 1 THEN 'PATROL_STARTED'
      ELSE 'CHECKPOINT_ACCEPTED'
    END,
    v_final.status,
    NULL::text,
    session_row.schedule_id,
    COALESCE(v_final.checkpoint_completed,0),
    COALESCE(v_final.checkpoint_total,0),
    COALESCE(v_final.progress_percent,0),
    v_next_id,
    v_next_name,
    reason;
END;
$function$;