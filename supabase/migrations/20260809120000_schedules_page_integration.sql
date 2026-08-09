-- Schedules page integration: metadata, realtime, and frequency support.

ALTER TABLE public.patrol_schedules
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS schedule_code text,
  ADD COLUMN IF NOT EXISTS expected_duration_minutes integer;

UPDATE public.patrol_schedules
SET expected_duration_minutes = COALESCE(expected_duration_minutes, grace_completion_minutes, 60)
WHERE expected_duration_minutes IS NULL;

ALTER TABLE public.patrol_schedules
  ALTER COLUMN expected_duration_minutes SET DEFAULT 60;

ALTER TABLE public.patrol_schedules
  DROP CONSTRAINT IF EXISTS patrol_schedules_frequency_check,
  DROP CONSTRAINT IF EXISTS patrol_schedules_frequency_type_check;

ALTER TABLE public.patrol_schedules
  ADD CONSTRAINT patrol_schedules_frequency_check
  CHECK (frequency IN ('once', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly', 'custom', 'every_n_minutes', 'every_n_hours')),
  ADD CONSTRAINT patrol_schedules_frequency_type_check
  CHECK (frequency_type IN ('once', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly', 'custom', 'every_n_minutes', 'every_n_hours'));

WITH numbered AS (
  SELECT id, 'SCH-' || lpad(row_number() OVER (PARTITION BY company_id ORDER BY created_at, id)::text, 4, '0') AS code
  FROM public.patrol_schedules
  WHERE schedule_code IS NULL
)
UPDATE public.patrol_schedules ps
SET schedule_code = numbered.code
FROM numbered
WHERE ps.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patrol_schedules_company_code
ON public.patrol_schedules(company_id, schedule_code)
WHERE schedule_code IS NOT NULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patrol_schedules;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_patrol_schedule_run(
  p_current timestamptz,
  p_frequency text,
  p_interval integer,
  p_days integer[]
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  candidate timestamptz := p_current;
  step_count integer := 0;
BEGIN
  IF p_frequency = 'once' THEN
    RETURN NULL;
  ELSIF p_frequency = 'every_n_minutes' THEN
    RETURN p_current + make_interval(mins => GREATEST(COALESCE(p_interval, 1), 1));
  ELSIF p_frequency IN ('hourly', 'every_n_hours') THEN
    RETURN p_current + make_interval(hours => GREATEST(COALESCE(p_interval, 1), 1));
  ELSIF p_frequency = 'weekly' THEN
    RETURN p_current + make_interval(days => 7 * GREATEST(COALESCE(p_interval, 1), 1));
  ELSIF p_frequency = 'weekdays' THEN
    LOOP
      candidate := candidate + interval '1 day';
      EXIT WHEN EXTRACT(DOW FROM candidate)::integer BETWEEN 1 AND 5;
    END LOOP;
    RETURN candidate;
  ELSIF p_frequency = 'weekends' THEN
    LOOP
      candidate := candidate + interval '1 day';
      EXIT WHEN EXTRACT(DOW FROM candidate)::integer IN (0, 6);
    END LOOP;
    RETURN candidate;
  ELSIF p_frequency = 'custom' AND COALESCE(array_length(p_days, 1), 0) > 0 THEN
    LOOP
      candidate := candidate + interval '1 day';
      step_count := step_count + 1;
      EXIT WHEN EXTRACT(DOW FROM candidate)::integer = ANY(p_days) OR step_count > 14;
    END LOOP;
    RETURN candidate;
  END IF;
  RETURN p_current + make_interval(days => GREATEST(COALESCE(p_interval, 1), 1));
END;
$$;

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
          company_id, session_id, route_checkpoint_id, checkpoint_id, scheduled_order, scheduled_at, status
        )
        SELECT schedule_row.company_id, session_id, prc.id, prc.checkpoint_id, prc.sequence_order,
               session_start + COALESCE(prc.expected_offset_minutes, prc.expected_arrival_offset_minutes, 0) * interval '1 minute',
               'pending'
        FROM public.patrol_route_checkpoints prc
        WHERE prc.route_id = schedule_row.route_id
        ORDER BY prc.sequence_order
        ON CONFLICT DO NOTHING;
      END IF;

      next_run := public.next_patrol_schedule_run(session_start, COALESCE(schedule_row.frequency_type, schedule_row.frequency, 'daily'), schedule_row.interval_value, schedule_row.days_of_week);
      IF next_run IS NULL OR (schedule_row.active_until IS NOT NULL AND next_run > schedule_row.active_until) THEN
        UPDATE public.patrol_schedules
        SET next_run_at = NULL,
            status = CASE WHEN COALESCE(schedule_row.frequency_type, schedule_row.frequency) = 'once' THEN 'paused' ELSE status END,
            updated_at = now()
        WHERE id = schedule_row.id;
        EXIT;
      END IF;
      session_start := next_run;
    END LOOP;

    IF session_start IS NOT NULL THEN
      UPDATE public.patrol_schedules SET next_run_at = session_start, updated_at = now() WHERE id = schedule_row.id;
    END IF;
  END LOOP;
  RETURN generated_count;
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
  expired_ids uuid[];
BEGIN
  UPDATE public.patrol_sessions
  SET status = 'awaiting_start', updated_at = now()
  WHERE status = 'scheduled' AND scheduled_start <= now();
  GET DIAGNOSTICS affected_count = ROW_COUNT;

  SELECT array_agg(id) INTO expired_ids
  FROM public.patrol_sessions
  WHERE status IN ('scheduled', 'awaiting_start', 'active', 'in_progress', 'late_start', 'late', 'delayed')
    AND scheduled_end IS NOT NULL
    AND scheduled_end < now()
    AND COALESCE(checkpoint_completed, completed_required_count, 0) < COALESCE(checkpoint_total, total_required_count, 0);

  UPDATE public.patrol_sessions
  SET status = CASE WHEN COALESCE(checkpoint_completed, completed_required_count, 0) > 0 THEN 'incomplete' ELSE 'missed' END,
      missed_reason = CASE WHEN COALESCE(checkpoint_completed, completed_required_count, 0) > 0 THEN 'Some required checkpoints were not scanned before the session window closed.' ELSE 'No checkpoint scans were received before the session window closed.' END,
      updated_at = now()
  WHERE id = ANY(COALESCE(expired_ids, ARRAY[]::uuid[]));

  UPDATE public.patrol_session_checkpoints
  SET status = 'missed', updated_at = now()
  WHERE session_id = ANY(COALESCE(expired_ids, ARRAY[]::uuid[]))
    AND status IN ('pending', 'current', 'late');

  RETURN affected_count + COALESCE(array_length(expired_ids, 1), 0);
END;
$$;

NOTIFY pgrst, 'reload schema';
