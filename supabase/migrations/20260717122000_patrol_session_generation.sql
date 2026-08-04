-- Widen status constraints if an earlier draft migration was already applied.
DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.patrol_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.patrol_sessions DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;

  ALTER TABLE public.patrol_sessions
    ADD CONSTRAINT patrol_sessions_status_check
    CHECK (status IN ('scheduled', 'awaiting_start', 'active', 'in_progress', 'late_start', 'late', 'delayed', 'completed', 'completed_late', 'missed', 'incomplete', 'cancelled', 'paused'));

  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.patrol_session_checkpoints'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.patrol_session_checkpoints DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;

  ALTER TABLE public.patrol_session_checkpoints
    ADD CONSTRAINT patrol_session_checkpoints_status_check
    CHECK (status IN ('pending', 'current', 'scanned', 'scanned_late', 'late', 'missed', 'skipped', 'out_of_order'));
END $$;
-- Idempotent patrol session generation.
-- Intended to be called by a Supabase scheduled Edge Function, pg_cron job, or manually before demos.

ALTER TABLE public.patrol_schedules
  ADD COLUMN IF NOT EXISTS frequency_type text,
  ADD COLUMN IF NOT EXISTS active_from timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS active_until timestamptz,
  ADD COLUMN IF NOT EXISTS grace_start_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS grace_completion_minutes integer NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS device_identifier text;

UPDATE public.patrol_schedules
SET frequency_type = CASE frequency
  WHEN 'hourly' THEN 'hourly'
  WHEN 'daily' THEN 'daily'
  ELSE COALESCE(frequency_type, 'hourly')
END
WHERE frequency_type IS NULL;

ALTER TABLE public.patrol_route_checkpoints
  ADD COLUMN IF NOT EXISTS expected_offset_minutes integer;

UPDATE public.patrol_route_checkpoints
SET expected_offset_minutes = expected_arrival_offset_minutes
WHERE expected_offset_minutes IS NULL
  AND expected_arrival_offset_minutes IS NOT NULL;

ALTER TABLE public.patrol_sessions
  ADD COLUMN IF NOT EXISTS checkpoint_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkpoint_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS missed_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patrol_sessions_schedule_start_unique
ON public.patrol_sessions(schedule_id, scheduled_start)
WHERE schedule_id IS NOT NULL;

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
BEGIN
  FOR schedule_row IN
    SELECT *
    FROM public.patrol_schedules
    WHERE status = 'active'
      AND route_id IS NOT NULL
      AND COALESCE(next_run_at, active_from, now()) <= p_until
      AND (active_until IS NULL OR active_until >= now())
  LOOP
    session_start := COALESCE(schedule_row.next_run_at, schedule_row.active_from, now());

    WHILE session_start <= p_until LOOP
      session_end := CASE
        WHEN schedule_row.end_time IS NOT NULL AND schedule_row.start_time IS NOT NULL THEN
          session_start + GREATEST(
            EXTRACT(EPOCH FROM (schedule_row.end_time - schedule_row.start_time))::integer,
            COALESCE(schedule_row.grace_completion_minutes, 40) * 60
          ) * interval '1 second'
        ELSE session_start + COALESCE(schedule_row.grace_completion_minutes, 40) * interval '1 minute'
      END;

      SELECT COUNT(*) FILTER (WHERE COALESCE(is_required, true))
      INTO route_total
      FROM public.patrol_route_checkpoints
      WHERE route_id = schedule_row.route_id;

      INSERT INTO public.patrol_sessions (
        company_id,
        site_id,
        template_id,
        route_id,
        schedule_id,
        device_identifier,
        status,
        scheduled_start,
        scheduled_end,
        checkpoint_total,
        checkpoint_completed,
        progress_percent,
        total_required_count,
        completed_required_count,
        progress,
        meta
      ) VALUES (
        schedule_row.company_id,
        schedule_row.site_id,
        schedule_row.template_id,
        schedule_row.route_id,
        schedule_row.id,
        schedule_row.device_identifier,
        CASE WHEN session_start <= now() THEN 'awaiting_start' ELSE 'scheduled' END,
        session_start,
        session_end,
        COALESCE(route_total, 0),
        0,
        0,
        COALESCE(route_total, 0),
        0,
        0,
        jsonb_build_object('generated_by', 'generate_due_patrol_sessions')
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO session_id;

      IF session_id IS NOT NULL THEN
        generated_count := generated_count + 1;

        INSERT INTO public.patrol_session_checkpoints (
          company_id,
          session_id,
          route_checkpoint_id,
          checkpoint_id,
          scheduled_order,
          scheduled_at,
          status
        )
        SELECT
          schedule_row.company_id,
          session_id,
          prc.id,
          prc.checkpoint_id,
          prc.sequence_order,
          CASE
            WHEN prc.expected_offset_minutes IS NOT NULL THEN session_start + prc.expected_offset_minutes * interval '1 minute'
            ELSE NULL
          END,
          CASE WHEN prc.sequence_order = 1 THEN 'current' ELSE 'pending' END
        FROM public.patrol_route_checkpoints prc
        WHERE prc.route_id = schedule_row.route_id
        ORDER BY prc.sequence_order;
      END IF;

      session_id := NULL;
      session_start := CASE COALESCE(schedule_row.frequency_type, schedule_row.frequency)
        WHEN 'every_n_minutes' THEN session_start + schedule_row.interval_value * interval '1 minute'
        WHEN 'hourly' THEN session_start + schedule_row.interval_value * interval '1 hour'
        WHEN 'every_n_hours' THEN session_start + schedule_row.interval_value * interval '1 hour'
        WHEN 'daily' THEN session_start + schedule_row.interval_value * interval '1 day'
        ELSE session_start + interval '1 hour'
      END;
    END LOOP;

    UPDATE public.patrol_schedules
    SET next_run_at = session_start,
        updated_at = now()
    WHERE id = schedule_row.id;
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
BEGIN
  UPDATE public.patrol_sessions
  SET status = 'awaiting_start', updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_start <= now();
  GET DIAGNOSTICS affected_count = ROW_COUNT;

  UPDATE public.patrol_sessions
  SET status = CASE WHEN COALESCE(checkpoint_completed, completed_required_count, 0) > 0 THEN 'incomplete' ELSE 'missed' END,
      missed_reason = CASE WHEN COALESCE(checkpoint_completed, completed_required_count, 0) > 0 THEN 'Some required checkpoints were not scanned before the session window closed.' ELSE 'No checkpoint scans were received before the session window closed.' END,
      updated_at = now()
  WHERE status IN ('scheduled', 'awaiting_start', 'active', 'in_progress', 'late_start', 'late', 'delayed')
    AND scheduled_end IS NOT NULL
    AND scheduled_end < now()
    AND COALESCE(checkpoint_completed, completed_required_count, 0) < COALESCE(checkpoint_total, total_required_count, 0);

  RETURN affected_count;
END;
$$;

NOTIFY pgrst, 'reload schema';