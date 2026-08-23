-- Data Log Forms for checkpoint registration and scan completion gating.

ALTER TABLE public.checkpoints
  ADD COLUMN IF NOT EXISTS location_note text,
  ADD COLUMN IF NOT EXISTS data_log_form_id uuid;

CREATE TABLE IF NOT EXISTS public.data_log_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  form_type text NOT NULL CHECK (form_type IN ('checklist', 'data_entry', 'mixed')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_log_form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.data_log_forms(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text','long_text','number','date','time','datetime','yes_no','dropdown','multiple_choice','checkbox','pass_fail','photo','signature','temperature','meter_reading','quantity')),
  required boolean NOT NULL DEFAULT false,
  sequence_order integer NOT NULL DEFAULT 1,
  placeholder text,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, sequence_order)
);

CREATE TABLE IF NOT EXISTS public.data_log_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  checkpoint_id uuid NOT NULL REFERENCES public.checkpoints(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.data_log_forms(id) ON DELETE RESTRICT,
  patrol_session_id uuid REFERENCES public.patrol_sessions(id) ON DELETE SET NULL,
  patrol_session_checkpoint_id uuid REFERENCES public.patrol_session_checkpoints(id) ON DELETE SET NULL,
  scan_log_id uuid REFERENCES public.scan_logs(id) ON DELETE SET NULL,
  device_id text,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','rejected','synced')),
  responses_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_log_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkpoints_data_log_form_id_fkey') THEN
    ALTER TABLE public.checkpoints
      ADD CONSTRAINT checkpoints_data_log_form_id_fkey
      FOREIGN KEY (data_log_form_id) REFERENCES public.data_log_forms(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.patrol_session_checkpoints
  ADD COLUMN IF NOT EXISTS data_log_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_log_status text NOT NULL DEFAULT 'not_required' CHECK (data_log_status IN ('not_required','awaiting_data','submitted')),
  ADD COLUMN IF NOT EXISTS data_log_form_id uuid REFERENCES public.data_log_forms(id) ON DELETE SET NULL;

ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS data_log_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_log_status text NOT NULL DEFAULT 'not_required' CHECK (data_log_status IN ('not_required','awaiting_data','submitted'));

CREATE INDEX IF NOT EXISTS idx_data_log_forms_company_site ON public.data_log_forms(company_id, site_id, is_active);
CREATE INDEX IF NOT EXISTS idx_data_log_form_fields_form_order ON public.data_log_form_fields(form_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_data_log_submissions_checkpoint_time ON public.data_log_submissions(company_id, checkpoint_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_session_checkpoints_awaiting_data ON public.patrol_session_checkpoints(company_id, status, data_log_status) WHERE data_log_status = 'awaiting_data';
CREATE INDEX IF NOT EXISTS idx_checkpoints_data_log_form ON public.checkpoints(data_log_form_id) WHERE data_log_form_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_data_log_forms_updated_at ON public.data_log_forms;
CREATE TRIGGER update_data_log_forms_updated_at BEFORE UPDATE ON public.data_log_forms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_data_log_form_fields_updated_at ON public.data_log_form_fields;
CREATE TRIGGER update_data_log_form_fields_updated_at BEFORE UPDATE ON public.data_log_form_fields FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.data_log_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_log_form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_log_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_log_forms_read_company ON public.data_log_forms;
CREATE POLICY data_log_forms_read_company ON public.data_log_forms FOR SELECT USING (company_id = public.get_user_company_id(auth.uid()));
DROP POLICY IF EXISTS data_log_forms_manage_company ON public.data_log_forms;
CREATE POLICY data_log_forms_manage_company ON public.data_log_forms FOR ALL USING (company_id = public.get_user_company_id(auth.uid()) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))) WITH CHECK (company_id = public.get_user_company_id(auth.uid()) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')));
DROP POLICY IF EXISTS data_log_form_fields_read_company ON public.data_log_form_fields;
CREATE POLICY data_log_form_fields_read_company ON public.data_log_form_fields FOR SELECT USING (company_id = public.get_user_company_id(auth.uid()));
DROP POLICY IF EXISTS data_log_form_fields_manage_company ON public.data_log_form_fields;
CREATE POLICY data_log_form_fields_manage_company ON public.data_log_form_fields FOR ALL USING (company_id = public.get_user_company_id(auth.uid()) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))) WITH CHECK (company_id = public.get_user_company_id(auth.uid()) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')));
DROP POLICY IF EXISTS data_log_submissions_read_company ON public.data_log_submissions;
CREATE POLICY data_log_submissions_read_company ON public.data_log_submissions FOR SELECT USING (company_id = public.get_user_company_id(auth.uid()));
DROP POLICY IF EXISTS data_log_submissions_insert_company ON public.data_log_submissions;
CREATE POLICY data_log_submissions_insert_company ON public.data_log_submissions FOR INSERT WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.submit_data_log_submission(p_scan_log_id uuid, p_responses_json jsonb, p_submitted_by uuid DEFAULT auth.uid())
RETURNS TABLE(submission_id uuid, patrol_session_id uuid, session_checkpoint_id uuid, status text, completed integer, required integer, progress_percent numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  scan_row record; psc_row record; form_row record; field_row record; response_value jsonb; errors jsonb := '[]'::jsonb; submission_row record; was_late boolean := false; final_session record;
BEGIN
  SELECT * INTO scan_row FROM public.scan_logs WHERE id = p_scan_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scan log % not found', p_scan_log_id; END IF;
  IF auth.uid() IS NOT NULL AND scan_row.company_id <> public.get_user_company_id(auth.uid()) THEN RAISE EXCEPTION 'Not authorized for this scan'; END IF;

  SELECT * INTO psc_row FROM public.patrol_session_checkpoints WHERE scan_log_id = p_scan_log_id ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No patrol checkpoint is awaiting data for this scan'; END IF;
  IF psc_row.data_log_form_id IS NULL OR psc_row.data_log_status <> 'awaiting_data' THEN RAISE EXCEPTION 'This checkpoint does not require a pending data log form'; END IF;

  SELECT * INTO form_row FROM public.data_log_forms WHERE id = psc_row.data_log_form_id AND company_id = scan_row.company_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data Log Form is not active or does not belong to this company'; END IF;

  FOR field_row IN SELECT * FROM public.data_log_form_fields WHERE form_id = form_row.id AND company_id = form_row.company_id AND is_active = true ORDER BY sequence_order LOOP
    response_value := COALESCE(p_responses_json -> field_row.id::text, p_responses_json -> field_row.label);
    IF field_row.required AND (response_value IS NULL OR response_value = 'null'::jsonb OR response_value = '""'::jsonb OR response_value = '[]'::jsonb) THEN
      errors := errors || jsonb_build_array(jsonb_build_object('field_id', field_row.id, 'field', field_row.label, 'message', field_row.label || ' is required'));
    ELSIF response_value IS NOT NULL AND field_row.field_type IN ('number','temperature','meter_reading','quantity') THEN
      IF NOT (response_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        errors := errors || jsonb_build_array(jsonb_build_object('field_id', field_row.id, 'field', field_row.label, 'message', field_row.label || ' must be numeric'));
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(errors) > 0 THEN
    INSERT INTO public.data_log_submissions (company_id, site_id, checkpoint_id, form_id, patrol_session_id, patrol_session_checkpoint_id, scan_log_id, device_id, submitted_by, status, responses_json, validation_errors)
    VALUES (scan_row.company_id, scan_row.site_id, scan_row.checkpoint_id, form_row.id, scan_row.patrol_session_id, psc_row.id, scan_row.id, scan_row.device_identifier, p_submitted_by, 'rejected', COALESCE(p_responses_json, '{}'::jsonb), errors)
    ON CONFLICT (scan_log_id) DO UPDATE SET status = 'rejected', responses_json = EXCLUDED.responses_json, validation_errors = EXCLUDED.validation_errors, submitted_at = now()
    RETURNING * INTO submission_row;
    RAISE EXCEPTION 'Data Log validation failed: %', errors::text;
  END IF;

  INSERT INTO public.data_log_submissions (company_id, site_id, checkpoint_id, form_id, patrol_session_id, patrol_session_checkpoint_id, scan_log_id, device_id, submitted_by, status, responses_json, validation_errors)
  VALUES (scan_row.company_id, scan_row.site_id, scan_row.checkpoint_id, form_row.id, scan_row.patrol_session_id, psc_row.id, scan_row.id, scan_row.device_identifier, p_submitted_by, 'submitted', COALESCE(p_responses_json, '{}'::jsonb), '[]'::jsonb)
  ON CONFLICT (scan_log_id) DO UPDATE SET status = 'submitted', responses_json = EXCLUDED.responses_json, validation_errors = '[]'::jsonb, submitted_at = now()
  RETURNING * INTO submission_row;

  was_late := psc_row.scheduled_at IS NOT NULL AND scan_row.scanned_at > psc_row.scheduled_at + interval '10 minutes';
  UPDATE public.patrol_session_checkpoints SET status = CASE WHEN was_late THEN 'scanned_late' ELSE 'scanned' END, data_log_status = 'submitted', audit_meta = COALESCE(audit_meta, '{}'::jsonb) || jsonb_build_object('data_log_submission_id', submission_row.id, 'data_log_submitted_at', now()), updated_at = now() WHERE id = psc_row.id;
  UPDATE public.scan_logs SET data_log_status = 'submitted' WHERE id = scan_row.id;
  PERFORM public.recalculate_patrol_session_progress(psc_row.session_id);
  SELECT * INTO final_session FROM public.patrol_sessions WHERE id = psc_row.session_id;

  RETURN QUERY SELECT submission_row.id, psc_row.session_id, psc_row.id, 'submitted'::text, COALESCE(final_session.checkpoint_completed, 0), COALESCE(final_session.checkpoint_total, 0), COALESCE(final_session.progress_percent, 0);
END;
$$;

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
  expected_checkpoint_row record;
  recent_row record;
  reason text;
  was_late boolean := false;
  enforce_sequence boolean := false;
  v_next_id uuid;
  v_next_name text;
  v_final record;
  v_data_log_form_id uuid;
  v_requires_data_log boolean := false;
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

  SELECT c.data_log_form_id INTO v_data_log_form_id
  FROM public.checkpoints c
  WHERE c.id = checkpoint_row.checkpoint_id;
  v_requires_data_log := v_data_log_form_id IS NOT NULL;

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

  IF enforce_sequence
    AND expected_checkpoint_row.id IS NOT NULL
    AND expected_checkpoint_row.id <> checkpoint_row.id THEN
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

  IF checkpoint_row.status IN ('scanned','scanned_late','awaiting_data') THEN
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
  SET status = CASE WHEN v_requires_data_log THEN 'awaiting_data' WHEN was_late THEN 'scanned_late' ELSE 'scanned' END,
      data_log_required = v_requires_data_log,
      data_log_status = CASE WHEN v_requires_data_log THEN 'awaiting_data' ELSE 'not_required' END,
      data_log_form_id = v_data_log_form_id,
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
      data_log_required = v_requires_data_log,
      data_log_status = CASE WHEN v_requires_data_log THEN 'awaiting_data' ELSE 'not_required' END,
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
      WHEN v_requires_data_log THEN 'CHECKPOINT_REQUIRES_DATA'
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


REVOKE ALL ON FUNCTION public.submit_data_log_submission(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_data_log_submission(uuid, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_scan_to_patrol_session(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_scan_to_patrol_session(uuid) TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_log_forms TO authenticated;
GRANT ALL ON public.data_log_forms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_log_form_fields TO authenticated;
GRANT ALL ON public.data_log_form_fields TO service_role;
GRANT SELECT, INSERT ON public.data_log_submissions TO authenticated;
GRANT ALL ON public.data_log_submissions TO service_role;
