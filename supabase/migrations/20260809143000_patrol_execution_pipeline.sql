-- Coherent patrol execution pipeline: session finalization, snapshot reporting, incident/SOS links.

ALTER TABLE public.patrol_session_checkpoints
  ADD COLUMN IF NOT EXISTS checkpoint_name_snapshot text,
  ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gps_lat numeric,
  ADD COLUMN IF NOT EXISTS gps_lng numeric,
  ADD COLUMN IF NOT EXISTS gps_accuracy numeric,
  ADD COLUMN IF NOT EXISTS audit_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.patrol_session_checkpoints psc
SET checkpoint_name_snapshot = COALESCE(psc.checkpoint_name_snapshot, c.name),
    required = COALESCE(prc.is_required, psc.required, true)
FROM public.checkpoints c
LEFT JOIN public.patrol_route_checkpoints prc ON prc.id = psc.route_checkpoint_id
WHERE c.id = psc.checkpoint_id
  AND (psc.checkpoint_name_snapshot IS NULL OR psc.required IS NULL);

ALTER TABLE public.patrol_sessions
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS critical_incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sos_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unacknowledged_sos_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latest_sos_at timestamptz;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.patrol_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_identifier text,
  ADD COLUMN IF NOT EXISTS event_occurred_at timestamptz;

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.patrol_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_identifier text,
  ADD COLUMN IF NOT EXISTS event_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_lat numeric,
  ADD COLUMN IF NOT EXISTS location_lng numeric,
  ADD COLUMN IF NOT EXISTS gps_accuracy numeric;

CREATE INDEX IF NOT EXISTS idx_patrol_sessions_schedule_id ON public.patrol_sessions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_patrol_sessions_company_site_time ON public.patrol_sessions(company_id, site_id, scheduled_start DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_sessions_company_device_window ON public.patrol_sessions(company_id, device_identifier, scheduled_start DESC, scheduled_end DESC) WHERE device_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patrol_session_checkpoints_checkpoint ON public.patrol_session_checkpoints(company_id, checkpoint_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_session ON public.incidents(company_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_session ON public.alerts(company_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_device_time ON public.alerts(company_id, device_identifier, (COALESCE(event_occurred_at, created_at)) DESC) WHERE device_identifier IS NOT NULL;

CREATE OR REPLACE FUNCTION public.find_eligible_patrol_session_for_event(
  p_company_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_device_identifier text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_checkpoint_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  SELECT ps.id INTO v_session_id
  FROM public.patrol_sessions ps
  WHERE ps.company_id = p_company_id
    AND ps.status IN ('scheduled','awaiting_start','active','in_progress','late_start','late','delayed','incomplete','missed')
    AND (p_site_id IS NULL OR ps.site_id IS NULL OR ps.site_id = p_site_id)
    AND (p_device_identifier IS NULL OR ps.device_identifier IS NULL OR ps.device_identifier = p_device_identifier)
    AND COALESCE(p_occurred_at, now()) >= ps.scheduled_start - interval '15 minutes'
    AND (ps.scheduled_end IS NULL OR COALESCE(p_occurred_at, now()) <= ps.scheduled_end + interval '15 minutes')
    AND (
      p_checkpoint_id IS NULL OR EXISTS (
        SELECT 1 FROM public.patrol_session_checkpoints psc
        WHERE psc.session_id = ps.id AND psc.checkpoint_id = p_checkpoint_id
      )
    )
  ORDER BY
    CASE WHEN ps.status IN ('active','in_progress') THEN 0 ELSE 1 END,
    CASE WHEN p_device_identifier IS NOT NULL AND ps.device_identifier = p_device_identifier THEN 0 ELSE 1 END,
    ABS(EXTRACT(EPOCH FROM (COALESCE(p_occurred_at, now()) - ps.scheduled_start))),
    ps.created_at
  LIMIT 1;
  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_patrol_session_progress(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  required_total integer;
  required_done integer;
  required_missed integer;
  first_scan timestamptz;
  last_scan timestamptz;
  session_row record;
  next_status text;
BEGIN
  SELECT * INTO session_row FROM public.patrol_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COUNT(*) FILTER (WHERE COALESCE(psc.required, prc.is_required, true)),
    COUNT(*) FILTER (WHERE COALESCE(psc.required, prc.is_required, true) AND psc.status IN ('scanned', 'scanned_late')),
    COUNT(*) FILTER (WHERE COALESCE(psc.required, prc.is_required, true) AND psc.status = 'missed'),
    MIN(psc.scanned_at),
    MAX(psc.scanned_at)
  INTO required_total, required_done, required_missed, first_scan, last_scan
  FROM public.patrol_session_checkpoints psc
  LEFT JOIN public.patrol_route_checkpoints prc ON prc.id = psc.route_checkpoint_id
  WHERE psc.session_id = p_session_id;

  required_total := COALESCE(required_total, 0);
  required_done := COALESCE(required_done, 0);
  required_missed := COALESCE(required_missed, 0);

  next_status := CASE
    WHEN session_row.status = 'cancelled' THEN 'cancelled'
    WHEN required_total > 0 AND required_done >= required_total AND last_scan IS NOT NULL AND session_row.scheduled_end IS NOT NULL AND last_scan > session_row.scheduled_end THEN 'completed_late'
    WHEN required_total > 0 AND required_done >= required_total THEN 'completed'
    WHEN session_row.scheduled_end IS NOT NULL AND now() > session_row.scheduled_end AND required_done > 0 THEN 'incomplete'
    WHEN session_row.scheduled_end IS NOT NULL AND now() > session_row.scheduled_end AND required_done = 0 THEN 'missed'
    WHEN required_done > 0 THEN 'active'
    ELSE session_row.status
  END;

  UPDATE public.patrol_sessions
  SET completed_required_count = required_done,
      total_required_count = required_total,
      checkpoint_completed = required_done,
      checkpoint_total = GREATEST(required_total, checkpoint_total),
      progress = CASE WHEN required_total > 0 THEN ROUND((required_done::numeric / required_total::numeric) * 100, 2) ELSE 0 END,
      progress_percent = CASE WHEN required_total > 0 THEN ROUND((required_done::numeric / required_total::numeric) * 100, 2) ELSE 0 END,
      first_scan_at = COALESCE(first_scan, first_scan_at),
      last_scan_at = COALESCE(last_scan, last_scan_at),
      actual_start = COALESCE(actual_start, first_scan),
      actual_end = CASE WHEN required_total > 0 AND required_done >= required_total THEN COALESCE(actual_end, last_scan, now()) ELSE actual_end END,
      status = next_status,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('missed_checkpoint_count', required_missed, 'last_progress_recalc_at', now()),
      updated_at = now()
  WHERE id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_patrol_session_event_counts(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.patrol_sessions ps
  SET incident_count = counts.incident_count,
      open_incident_count = counts.open_incident_count,
      critical_incident_count = counts.critical_incident_count,
      sos_count = counts.sos_count,
      unacknowledged_sos_count = counts.unacknowledged_sos_count,
      latest_sos_at = counts.latest_sos_at,
      updated_at = now()
  FROM (
    SELECT
      (SELECT COUNT(*) FROM public.incidents i WHERE i.session_id = p_session_id) AS incident_count,
      (SELECT COUNT(*) FROM public.incidents i WHERE i.session_id = p_session_id AND COALESCE(i.resolved, false) = false) AS open_incident_count,
      (SELECT COUNT(*) FROM public.incidents i WHERE i.session_id = p_session_id AND i.severity = 'critical') AS critical_incident_count,
      (SELECT COUNT(*) FROM public.alerts a WHERE a.session_id = p_session_id AND a.type = 'panic_button') AS sos_count,
      (SELECT COUNT(*) FROM public.alerts a WHERE a.session_id = p_session_id AND a.type = 'panic_button' AND COALESCE(a.is_read, false) = false) AS unacknowledged_sos_count,
      (SELECT MAX(COALESCE(a.event_occurred_at, a.created_at)) FROM public.alerts a WHERE a.session_id = p_session_id AND a.type = 'panic_button') AS latest_sos_at
  ) counts
  WHERE ps.id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_patrol_session(p_session_id uuid)
RETURNS public.patrol_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_row public.patrol_sessions%ROWTYPE;
  remaining_required integer;
BEGIN
  SELECT * INTO session_row FROM public.patrol_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patrol session % not found', p_session_id;
  END IF;

  IF session_row.status = 'cancelled' THEN
    PERFORM public.refresh_patrol_session_event_counts(p_session_id);
    RETURN session_row;
  END IF;

  IF session_row.scheduled_end IS NOT NULL AND now() >= session_row.scheduled_end THEN
    UPDATE public.patrol_session_checkpoints
    SET status = 'missed',
        audit_meta = COALESCE(audit_meta, '{}'::jsonb) || jsonb_build_object('missed_by', 'finalize_patrol_session', 'missed_at', now()),
        updated_at = now()
    WHERE session_id = p_session_id
      AND COALESCE(required, true)
      AND status NOT IN ('scanned', 'scanned_late', 'skipped');
  END IF;

  PERFORM public.recalculate_patrol_session_progress(p_session_id);
  PERFORM public.refresh_patrol_session_event_counts(p_session_id);

  SELECT COUNT(*) INTO remaining_required
  FROM public.patrol_session_checkpoints
  WHERE session_id = p_session_id
    AND COALESCE(required, true)
    AND status NOT IN ('scanned', 'scanned_late', 'skipped');

  UPDATE public.patrol_sessions
  SET finalized_at = CASE WHEN scheduled_end IS NOT NULL AND now() >= scheduled_end AND remaining_required >= 0 THEN COALESCE(finalized_at, now()) ELSE finalized_at END,
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO session_row;

  RETURN session_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_due_patrol_session_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_count integer := 0;
  expired record;
BEGIN
  UPDATE public.patrol_sessions
  SET status = 'awaiting_start', updated_at = now()
  WHERE status = 'scheduled' AND scheduled_start <= now();
  GET DIAGNOSTICS affected_count = ROW_COUNT;

  FOR expired IN
    SELECT id FROM public.patrol_sessions
    WHERE status IN ('scheduled', 'awaiting_start', 'active', 'in_progress', 'late_start', 'late', 'delayed')
      AND scheduled_end IS NOT NULL
      AND scheduled_end < now()
      AND COALESCE(checkpoint_completed, completed_required_count, 0) < COALESCE(checkpoint_total, total_required_count, 0)
  LOOP
    PERFORM public.finalize_patrol_session(expired.id);
    affected_count := affected_count + 1;
  END LOOP;

  RETURN affected_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_patrol_session_event_count_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_session := OLD.session_id;
  ELSE
    target_session := NEW.session_id;
  END IF;

  IF target_session IS NOT NULL THEN
    PERFORM public.refresh_patrol_session_event_counts(target_session);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.session_id IS DISTINCT FROM NEW.session_id AND OLD.session_id IS NOT NULL THEN
    PERFORM public.refresh_patrol_session_event_counts(OLD.session_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_patrol_session_event_counts_incidents ON public.incidents;
CREATE TRIGGER trg_refresh_patrol_session_event_counts_incidents
AFTER INSERT OR UPDATE OR DELETE ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.apply_patrol_session_event_count_trigger();

DROP TRIGGER IF EXISTS trg_refresh_patrol_session_event_counts_alerts ON public.alerts;
CREATE TRIGGER trg_refresh_patrol_session_event_counts_alerts
AFTER INSERT OR UPDATE OR DELETE ON public.alerts
FOR EACH ROW EXECUTE FUNCTION public.apply_patrol_session_event_count_trigger();


-- Scan matcher override: keep normal matching, add late-offline reconciliation for missed sessions.
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
    AND ps.status IN ('scheduled','awaiting_start','active','in_progress','late_start','late','delayed','incomplete','missed')
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
      gps_lat = scan_row.gps_lat,
      gps_lng = scan_row.gps_lng,
      gps_accuracy = scan_row.gps_accuracy,
      audit_meta = COALESCE(audit_meta, '{}'::jsonb) || jsonb_build_object('matched_scan_log_id', p_scan_log_id, 'matched_at', now(), 'late_reconciliation', session_row.status IN ('missed','incomplete')),
      updated_at = now()
  WHERE id = checkpoint_row.id;

  UPDATE public.patrol_sessions
  SET status = CASE WHEN status IN ('scheduled','awaiting_start','late_start','late','delayed','missed','incomplete') THEN 'active' ELSE status END,
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

CREATE OR REPLACE VIEW public.patrol_session_reports AS
WITH checkpoint_rollup AS (
  SELECT
    psc.session_id,
    COUNT(*) FILTER (WHERE COALESCE(psc.required, true))::integer AS expected_checkpoints,
    COUNT(*) FILTER (WHERE COALESCE(psc.required, true) AND psc.status IN ('scanned', 'scanned_late'))::integer AS completed_checkpoints,
    COUNT(*) FILTER (WHERE COALESCE(psc.required, true) AND psc.status = 'missed')::integer AS missed_checkpoint_count,
    COALESCE(array_remove(array_agg(COALESCE(psc.checkpoint_name_snapshot, c.name) ORDER BY psc.scheduled_order) FILTER (WHERE COALESCE(psc.required, true) AND psc.status = 'missed'), NULL), ARRAY[]::text[]) AS missed_checkpoint_names,
    COALESCE(jsonb_agg(jsonb_build_object(
      'session_checkpoint_id', psc.id,
      'checkpoint_id', psc.checkpoint_id,
      'checkpoint_name', COALESCE(psc.checkpoint_name_snapshot, c.name),
      'scheduled_order', psc.scheduled_order,
      'required', COALESCE(psc.required, true),
      'status', psc.status,
      'scheduled_at', psc.scheduled_at,
      'scanned_at', psc.scanned_at,
      'scan_log_id', psc.scan_log_id,
      'gps_lat', psc.gps_lat,
      'gps_lng', psc.gps_lng,
      'gps_accuracy', psc.gps_accuracy
    ) ORDER BY psc.scheduled_order), '[]'::jsonb) AS checkpoints
  FROM public.patrol_session_checkpoints psc
  LEFT JOIN public.checkpoints c ON c.id = psc.checkpoint_id
  GROUP BY psc.session_id
), incident_rollup AS (
  SELECT
    i.session_id,
    COUNT(*)::integer AS incident_count,
    COUNT(*) FILTER (WHERE COALESCE(i.resolved, false) = false)::integer AS open_incident_count,
    COUNT(*) FILTER (WHERE i.severity = 'critical')::integer AS critical_incident_count,
    COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'severity', i.severity, 'resolved', i.resolved, 'created_at', i.created_at) ORDER BY i.created_at), '[]'::jsonb) AS incidents
  FROM public.incidents i
  WHERE i.session_id IS NOT NULL
  GROUP BY i.session_id
), sos_rollup AS (
  SELECT
    a.session_id,
    COUNT(*)::integer AS sos_count,
    COUNT(*) FILTER (WHERE COALESCE(a.is_read, false) = false)::integer AS unacknowledged_sos_count,
    MAX(COALESCE(a.event_occurred_at, a.created_at)) AS latest_sos_at,
    COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'message', a.message, 'severity', a.severity, 'is_read', a.is_read, 'created_at', a.created_at, 'occurred_at', COALESCE(a.event_occurred_at, a.created_at), 'gps_lat', a.location_lat, 'gps_lng', a.location_lng) ORDER BY COALESCE(a.event_occurred_at, a.created_at)), '[]'::jsonb) AS sos_alerts
  FROM public.alerts a
  WHERE a.session_id IS NOT NULL AND a.type = 'panic_button'
  GROUP BY a.session_id
)
SELECT
  ps.id AS session_id,
  ps.company_id,
  ps.site_id,
  sites.name AS site_name,
  ps.schedule_id,
  schedules.name AS schedule_name,
  ps.template_id,
  templates.name AS template_name,
  ps.route_id,
  routes.name AS route_name,
  ps.device_identifier,
  ps.device_id,
  ps.scheduled_start,
  ps.scheduled_end,
  ps.actual_start,
  ps.actual_end,
  ps.finalized_at,
  COALESCE(cr.expected_checkpoints, ps.total_required_count, ps.checkpoint_total, 0) AS expected_checkpoints,
  COALESCE(cr.completed_checkpoints, ps.completed_required_count, ps.checkpoint_completed, 0) AS completed_checkpoints,
  COALESCE(cr.missed_checkpoint_count, 0) AS missed_checkpoint_count,
  COALESCE(cr.missed_checkpoint_names, ARRAY[]::text[]) AS missed_checkpoint_names,
  COALESCE(ir.incident_count, 0) AS incident_count,
  COALESCE(ir.open_incident_count, 0) AS open_incident_count,
  COALESCE(ir.critical_incident_count, 0) AS critical_incident_count,
  COALESCE(sr.sos_count, 0) AS sos_count,
  COALESCE(sr.unacknowledged_sos_count, 0) AS unacknowledged_sos_count,
  sr.latest_sos_at,
  CASE WHEN ps.actual_start IS NOT NULL AND ps.actual_end IS NOT NULL THEN EXTRACT(EPOCH FROM (ps.actual_end - ps.actual_start))::integer ELSE NULL END AS duration_seconds,
  ps.progress_percent,
  ps.status,
  COALESCE(cr.checkpoints, '[]'::jsonb) AS checkpoints,
  COALESCE(ir.incidents, '[]'::jsonb) AS incidents,
  COALESCE(sr.sos_alerts, '[]'::jsonb) AS sos_alerts,
  ps.meta
FROM public.patrol_sessions ps
LEFT JOIN public.sites sites ON sites.id = ps.site_id
LEFT JOIN public.patrol_schedules schedules ON schedules.id = ps.schedule_id
LEFT JOIN public.patrol_templates templates ON templates.id = ps.template_id
LEFT JOIN public.patrol_routes routes ON routes.id = ps.route_id
LEFT JOIN checkpoint_rollup cr ON cr.session_id = ps.id
LEFT JOIN incident_rollup ir ON ir.session_id = ps.id
LEFT JOIN sos_rollup sr ON sr.session_id = ps.id;

CREATE OR REPLACE FUNCTION public.generate_due_patrol_sessions(p_until timestamptz DEFAULT now() + interval '24 hours')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_row record;
  session_start timestamptz;
  session_end timestamptz;
  session_id uuid;
  generated_count integer := 0;
  route_total integer;
  next_run timestamptz;
BEGIN
  FOR schedule_row IN
    SELECT * FROM public.patrol_schedules
    WHERE status = 'active'
      AND route_id IS NOT NULL
      AND COALESCE(next_run_at, active_from, now()) <= p_until
      AND (active_until IS NULL OR active_until >= now())
  LOOP
    session_start := COALESCE(schedule_row.next_run_at, schedule_row.active_from, now());
    WHILE session_start IS NOT NULL AND session_start <= p_until LOOP
      session_end := CASE
        WHEN schedule_row.end_time IS NOT NULL AND schedule_row.start_time IS NOT NULL THEN
          session_start + GREATEST(EXTRACT(EPOCH FROM (schedule_row.end_time - schedule_row.start_time))::integer, COALESCE(schedule_row.expected_duration_minutes, schedule_row.grace_completion_minutes, 40) * 60) * interval '1 second'
        ELSE session_start + COALESCE(schedule_row.expected_duration_minutes, schedule_row.grace_completion_minutes, 40) * interval '1 minute'
      END;

      SELECT COUNT(*) FILTER (WHERE COALESCE(is_required, true)) INTO route_total
      FROM public.patrol_route_checkpoints
      WHERE route_id = schedule_row.route_id;

      INSERT INTO public.patrol_sessions (
        company_id, site_id, template_id, route_id, schedule_id, device_identifier,
        status, scheduled_start, scheduled_end, checkpoint_total, checkpoint_completed, progress_percent,
        total_required_count, completed_required_count, progress, meta
      ) VALUES (
        schedule_row.company_id, schedule_row.site_id, schedule_row.template_id, schedule_row.route_id,
        schedule_row.id, schedule_row.device_identifier,
        CASE WHEN session_start <= now() THEN 'awaiting_start' ELSE 'scheduled' END,
        session_start, session_end, COALESCE(route_total, 0), 0, 0, COALESCE(route_total, 0), 0, 0,
        jsonb_build_object('generated_by', 'generate_due_patrol_sessions')
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO session_id;

      IF session_id IS NOT NULL THEN
        generated_count := generated_count + 1;
        INSERT INTO public.patrol_session_checkpoints (
          company_id, session_id, route_checkpoint_id, checkpoint_id, checkpoint_name_snapshot,
          required, scheduled_order, scheduled_at, status
        )
        SELECT schedule_row.company_id, session_id, prc.id, prc.checkpoint_id, c.name,
               COALESCE(prc.is_required, true), prc.sequence_order,
               session_start + COALESCE(prc.expected_offset_minutes, prc.expected_arrival_offset_minutes, 0) * interval '1 minute',
               'pending'
        FROM public.patrol_route_checkpoints prc
        LEFT JOIN public.checkpoints c ON c.id = prc.checkpoint_id
        WHERE prc.route_id = schedule_row.route_id
        ORDER BY prc.sequence_order
        ON CONFLICT DO NOTHING;
      END IF;

      next_run := public.next_patrol_schedule_run(session_start, COALESCE(schedule_row.frequency_type, schedule_row.frequency, 'daily'), schedule_row.interval_value, schedule_row.days_of_week);
      IF next_run IS NULL OR (schedule_row.active_until IS NOT NULL AND next_run > schedule_row.active_until) THEN
        UPDATE public.patrol_schedules
        SET next_run_at = NULL, updated_at = now()
        WHERE id = schedule_row.id;
        EXIT;
      END IF;
      UPDATE public.patrol_schedules
      SET next_run_at = next_run, updated_at = now()
      WHERE id = schedule_row.id;
      session_start := next_run;
    END LOOP;
  END LOOP;

  RETURN generated_count;
END;
$$;
NOTIFY pgrst, 'reload schema';
