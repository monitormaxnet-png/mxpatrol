CREATE OR REPLACE FUNCTION public.generate_due_patrol_sessions(p_until timestamp with time zone DEFAULT (now() + '24:00:00'::interval))
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  schedule_row record;
  session_start timestamptz;
  session_end timestamptz;
  session_id uuid;
  generated_count integer := 0;
  route_total integer;
  local_start timestamp;
  local_dow integer;
  local_time time;
  tz text;
  is_eligible boolean;
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
    tz := COALESCE(NULLIF(schedule_row.timezone, ''), 'UTC');

    WHILE session_start <= p_until LOOP
      -- Evaluate the occurrence against the schedule's active days and time window
      -- using the schedule's own timezone.
      BEGIN
        local_start := session_start AT TIME ZONE tz;
      EXCEPTION WHEN OTHERS THEN
        local_start := session_start AT TIME ZONE 'UTC';
      END;
      local_dow := EXTRACT(DOW FROM local_start)::integer;
      local_time := local_start::time;

      is_eligible := true;

      -- Active days: empty array means every day.
      IF schedule_row.days_of_week IS NOT NULL
         AND array_length(schedule_row.days_of_week, 1) IS NOT NULL
         AND array_length(schedule_row.days_of_week, 1) > 0
         AND NOT (local_dow = ANY (schedule_row.days_of_week))
      THEN
        is_eligible := false;
      END IF;

      -- Daily time window: null start/end means all day.
      IF is_eligible AND schedule_row.start_time IS NOT NULL AND local_time < schedule_row.start_time THEN
        is_eligible := false;
      END IF;

      IF is_eligible AND schedule_row.end_time IS NOT NULL THEN
        IF schedule_row.start_time IS NOT NULL AND schedule_row.end_time < schedule_row.start_time THEN
          -- Overnight window (e.g. 22:00 -> 05:00): eligible outside the daytime gap.
          IF local_time < schedule_row.start_time AND local_time > schedule_row.end_time THEN
            is_eligible := false;
          ELSE
            is_eligible := true;
          END IF;
        ELSIF local_time > schedule_row.end_time THEN
          is_eligible := false;
        END IF;
      END IF;

      IF is_eligible THEN
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
      END IF;

      session_id := NULL;
      session_start := CASE COALESCE(schedule_row.frequency_type, schedule_row.frequency)
        WHEN 'every_n_minutes' THEN session_start + schedule_row.interval_value * interval '1 minute'
        WHEN 'hourly' THEN session_start + schedule_row.interval_value * interval '1 hour'
        WHEN 'every_n_hours' THEN session_start + schedule_row.interval_value * interval '1 hour'
        WHEN 'daily' THEN session_start + schedule_row.interval_value * interval '1 day'
        WHEN 'weekly' THEN session_start + schedule_row.interval_value * interval '7 days'
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
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_due_patrol_sessions(timestamp with time zone) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_due_patrol_sessions(timestamp with time zone) TO service_role;