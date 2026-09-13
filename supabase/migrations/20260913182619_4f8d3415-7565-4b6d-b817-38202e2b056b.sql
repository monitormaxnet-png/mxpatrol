-- Device facts stay in scan_logs; system-level scan exceptions are tracked here for review.
CREATE TABLE IF NOT EXISTS public.scan_investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  device_id text,
  device_identifier text,
  checkpoint_id uuid REFERENCES public.checkpoints(id) ON DELETE SET NULL,
  scanned_uid text,
  scan_log_id uuid REFERENCES public.scan_logs(id) ON DELETE CASCADE,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric,
  longitude numeric,
  accuracy numeric,
  investigation_type text NOT NULL DEFAULT 'other' CHECK (investigation_type IN ('unscheduled_scan','unregistered_checkpoint','wrong_patrol','unknown_uid','location_mismatch','other')),
  registered_status text NOT NULL DEFAULT 'unknown' CHECK (registered_status IN ('registered','unregistered','unknown','rejected','pending_registration')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','resolved','ignored')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_log_id, investigation_type)
);

CREATE INDEX IF NOT EXISTS idx_scan_investigations_company_time ON public.scan_investigations(company_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_investigations_company_site_time ON public.scan_investigations(company_id, site_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_investigations_company_status ON public.scan_investigations(company_id, status, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_investigations_company_type ON public.scan_investigations(company_id, investigation_type, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_investigations_device ON public.scan_investigations(company_id, device_identifier, scanned_at DESC) WHERE device_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_investigations_checkpoint ON public.scan_investigations(company_id, checkpoint_id, scanned_at DESC) WHERE checkpoint_id IS NOT NULL;

GRANT SELECT, UPDATE ON public.scan_investigations TO authenticated;
GRANT ALL ON public.scan_investigations TO service_role;

ALTER TABLE public.scan_investigations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scan_investigations_read_company ON public.scan_investigations;
CREATE POLICY scan_investigations_read_company
ON public.scan_investigations FOR SELECT TO authenticated
USING (
  company_id IN (SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
);

DROP POLICY IF EXISTS scan_investigations_manage_company ON public.scan_investigations;
CREATE POLICY scan_investigations_manage_company
ON public.scan_investigations FOR UPDATE TO authenticated
USING (
  company_id IN (SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','supervisor'))
)
WITH CHECK (
  company_id IN (SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','supervisor'))
);

CREATE OR REPLACE FUNCTION public.create_scan_investigation_for_log(
  p_scan_log_id uuid,
  p_type text,
  p_reason text,
  p_registered_status text DEFAULT 'unknown'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  scan_row record;
  v_id uuid;
  v_type text := COALESCE(NULLIF(p_type, ''), 'other');
  v_registered_status text := COALESCE(NULLIF(p_registered_status, ''), 'unknown');
BEGIN
  SELECT * INTO scan_row FROM public.scan_logs WHERE id = p_scan_log_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_type NOT IN ('unscheduled_scan','unregistered_checkpoint','wrong_patrol','unknown_uid','location_mismatch','other') THEN
    v_type := 'other';
  END IF;
  IF v_registered_status NOT IN ('registered','unregistered','unknown','rejected','pending_registration') THEN
    v_registered_status := 'unknown';
  END IF;

  INSERT INTO public.scan_investigations (
    company_id, site_id, device_id, device_identifier, checkpoint_id, scanned_uid, scan_log_id,
    scanned_at, latitude, longitude, accuracy, investigation_type, registered_status, reason, status
  ) VALUES (
    scan_row.company_id, scan_row.site_id, scan_row.device_id, scan_row.device_identifier, scan_row.checkpoint_id,
    scan_row.tag_uid, scan_row.id, scan_row.scanned_at,
    scan_row.gps_lat, scan_row.gps_lng, scan_row.gps_accuracy, v_type, v_registered_status, p_reason, 'pending'
  )
  ON CONFLICT (scan_log_id, investigation_type) DO UPDATE
  SET reason = EXCLUDED.reason,
      registered_status = EXCLUDED.registered_status,
      site_id = COALESCE(EXCLUDED.site_id, public.scan_investigations.site_id),
      checkpoint_id = COALESCE(EXCLUDED.checkpoint_id, public.scan_investigations.checkpoint_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_scan_investigation_for_log(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_scan_investigation_for_log(uuid, text, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.match_scan_to_patrol_session(uuid);

CREATE OR REPLACE FUNCTION public.match_scan_to_patrol_session(p_scan_log_id uuid)
RETURNS TABLE(
  session_id uuid,
  session_checkpoint_id uuid,
  match_status text,
  code text,
  patrol_status text,
  checkpoint_status text,
  schedule_id uuid,
  completed_count integer,
  total_count integer,
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
  wrong_session_row record;
  checkpoint_row record;
  expected_checkpoint_row record;
  recent_row record;
  reason text;
  was_late boolean := false;
  enforce_sequence boolean := false;
  v_next_id uuid;
  v_next_name text;
  v_final record;
BEGIN
  SELECT * INTO scan_row FROM public.scan_logs WHERE id = p_scan_log_id;

  IF NOT FOUND OR scan_row.checkpoint_id IS NULL THEN
    IF FOUND THEN
      PERFORM public.create_scan_investigation_for_log(
        p_scan_log_id,
        CASE WHEN scan_row.tag_uid IS NULL THEN 'unknown_uid' ELSE 'unregistered_checkpoint' END,
        'Scan has no registered checkpoint and cannot affect scheduled patrol execution',
        COALESCE(scan_row.tag_status, 'unregistered')
      );
    END IF;
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'unmatched'::text, 'UNREGISTERED_CHECKPOINT'::text,
      NULL::text, NULL::text, NULL::uuid, 0, 0, 0::numeric, NULL::uuid, NULL::text, 'no_checkpoint'::text;
    RETURN;
  END IF;

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
    AND ps.status IN ('scheduled','awaiting_start','active','in_progress','late_start','late','delayed')
    AND (ps.site_id IS NULL OR scan_row.site_id IS NULL OR ps.site_id = scan_row.site_id)
    AND (ps.device_identifier IS NULL OR scan_row.device_identifier IS NULL OR ps.device_identifier = scan_row.device_identifier)
    AND scan_row.scanned_at >= ps.scheduled_start - interval '15 minutes'
    AND (ps.scheduled_end IS NULL OR scan_row.scanned_at <= ps.scheduled_end + interval '15 minutes')
    AND EXISTS (
      SELECT 1 FROM public.patrol_session_checkpoints psc
      WHERE psc.session_id = ps.id AND psc.checkpoint_id = scan_row.checkpoint_id
    )
  ORDER BY
    CASE WHEN ps.status IN ('active','in_progress') AND ps.device_identifier IS NOT NULL AND ps.device_identifier = scan_row.device_identifier THEN 0 ELSE 1 END,
    CASE WHEN scan_row.scanned_at >= ps.scheduled_start AND (ps.scheduled_end IS NULL OR scan_row.scanned_at <= ps.scheduled_end) THEN 0 ELSE 1 END,
    CASE WHEN ps.device_identifier IS NOT NULL AND ps.device_identifier = scan_row.device_identifier THEN 0 ELSE 1 END,
    ABS(EXTRACT(EPOCH FROM (scan_row.scanned_at - ps.scheduled_start))),
    ps.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT ps.* INTO wrong_session_row
    FROM public.patrol_sessions ps
    WHERE ps.company_id = scan_row.company_id
      AND ps.status IN ('scheduled','awaiting_start','active','in_progress','late_start','late','delayed')
      AND (ps.site_id IS NULL OR scan_row.site_id IS NULL OR ps.site_id = scan_row.site_id)
      AND (ps.device_identifier IS NULL OR scan_row.device_identifier IS NULL OR ps.device_identifier = scan_row.device_identifier)
      AND scan_row.scanned_at >= ps.scheduled_start - interval '15 minutes'
      AND (ps.scheduled_end IS NULL OR scan_row.scanned_at <= ps.scheduled_end + interval '15 minutes')
    ORDER BY
      CASE WHEN ps.status IN ('active','in_progress') AND ps.device_identifier IS NOT NULL AND ps.device_identifier = scan_row.device_identifier THEN 0 ELSE 1 END,
      ABS(EXTRACT(EPOCH FROM (scan_row.scanned_at - ps.scheduled_start))),
      ps.created_at
    LIMIT 1;

    UPDATE public.scan_logs
    SET patrol_match_status = CASE WHEN wrong_session_row.id IS NULL THEN 'no_active_session' ELSE 'wrong_patrol' END,
        patrol_validation_status = CASE WHEN wrong_session_row.id IS NULL THEN 'unscheduled' ELSE 'wrong_patrol' END
    WHERE id = p_scan_log_id;

    PERFORM public.create_scan_investigation_for_log(
      p_scan_log_id,
      CASE WHEN wrong_session_row.id IS NULL THEN 'unscheduled_scan' ELSE 'wrong_patrol' END,
      CASE WHEN wrong_session_row.id IS NULL THEN 'Registered checkpoint scan did not match an active scheduled patrol' ELSE 'Registered checkpoint is not part of the active patrol session route' END,
      'registered'
    );

    RETURN QUERY SELECT NULL::uuid, NULL::uuid,
      CASE WHEN wrong_session_row.id IS NULL THEN 'no_active_session' ELSE 'wrong_patrol' END::text,
      CASE WHEN wrong_session_row.id IS NULL THEN 'NO_ACTIVE_PATROL' ELSE 'CHECKPOINT_NOT_IN_ROUTE' END::text,
      NULL::text, NULL::text, NULL::uuid, 0, 0, 0::numeric, NULL::uuid, NULL::text,
      CASE WHEN wrong_session_row.id IS NULL THEN 'no_candidate' ELSE 'active_session_checkpoint_not_in_route' END::text;
    RETURN;
  END IF;

  reason := session_row.reason;

  SELECT COALESCE(pr.enforce_sequence, false) INTO enforce_sequence
  FROM public.patrol_routes pr
  WHERE pr.id = session_row.route_id;

  SELECT psc.* INTO checkpoint_row
  FROM public.patrol_session_checkpoints psc
  WHERE psc.session_id = session_row.id
    AND psc.checkpoint_id = scan_row.checkpoint_id
  ORDER BY psc.scheduled_order
  LIMIT 1
  FOR UPDATE;

  SELECT psc.checkpoint_id, c.name INTO v_next_id, v_next_name
  FROM public.patrol_session_checkpoints psc
  JOIN public.checkpoints c ON c.id = psc.checkpoint_id
  WHERE psc.session_id = session_row.id
    AND psc.status NOT IN ('scanned','scanned_late')
  ORDER BY psc.scheduled_order
  LIMIT 1;

  SELECT psc.*, c.name AS checkpoint_name INTO expected_checkpoint_row
  FROM public.patrol_session_checkpoints psc
  JOIN public.checkpoints c ON c.id = psc.checkpoint_id
  WHERE psc.session_id = session_row.id
    AND COALESCE(psc.required, true)
    AND psc.status NOT IN ('scanned','scanned_late','skipped')
  ORDER BY psc.scheduled_order
  LIMIT 1;

  IF enforce_sequence AND expected_checkpoint_row.id IS NOT NULL AND expected_checkpoint_row.id <> checkpoint_row.id THEN
    UPDATE public.scan_logs
    SET patrol_template_id = session_row.template_id,
        patrol_route_id = session_row.route_id,
        patrol_schedule_id = session_row.schedule_id,
        patrol_session_id = session_row.id,
        patrol_match_status = 'out_of_order',
        patrol_validation_status = 'out_of_order'
    WHERE id = p_scan_log_id;

    SELECT * INTO v_final FROM public.patrol_sessions WHERE id = session_row.id;

    RETURN QUERY SELECT session_row.id, checkpoint_row.id, 'out_of_order'::text, 'CHECKPOINT_OUT_OF_ORDER'::text,
      v_final.status, NULL::text, session_row.schedule_id,
      COALESCE(v_final.checkpoint_completed,0), COALESCE(v_final.checkpoint_total,0),
      COALESCE(v_final.progress_percent,0), expected_checkpoint_row.checkpoint_id, expected_checkpoint_row.checkpoint_name, reason;
    RETURN;
  END IF;

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
      audit_meta = COALESCE(audit_meta, '{}'::jsonb) || jsonb_build_object('matched_scan_log_id', p_scan_log_id, 'matched_at', now()),
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
      patrol_validation_status = CASE WHEN was_late THEN 'late' WHEN scan_row.scanned_at < session_row.scheduled_start THEN 'early' ELSE 'on_time' END
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

  RETURN QUERY SELECT session_row.id, checkpoint_row.id, 'matched'::text,
    CASE WHEN v_final.status = 'completed' THEN 'PATROL_COMPLETED' WHEN COALESCE(v_final.checkpoint_completed,0) <= 1 THEN 'PATROL_STARTED' ELSE 'CHECKPOINT_ACCEPTED' END,
    v_final.status, NULL::text, session_row.schedule_id,
    COALESCE(v_final.checkpoint_completed,0), COALESCE(v_final.checkpoint_total,0),
    COALESCE(v_final.progress_percent,0), v_next_id, v_next_name, reason;
END;
$function$;

REVOKE ALL ON FUNCTION public.match_scan_to_patrol_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_scan_to_patrol_session(uuid) TO service_role;