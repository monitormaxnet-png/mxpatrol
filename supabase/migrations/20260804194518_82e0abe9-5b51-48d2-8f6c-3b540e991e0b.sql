UPDATE public.scan_logs
SET patrol_session_id = NULL,
    patrol_schedule_id = NULL,
    patrol_route_id = NULL,
    patrol_template_id = NULL,
    patrol_match_status = 'no_active_session',
    patrol_validation_status = NULL
WHERE patrol_session_id = '80773311-d26f-4092-a2f1-bfaf2eb2f6f7';

UPDATE public.patrol_session_checkpoints
SET status = 'current',
    scanned_at = NULL,
    scan_log_id = NULL,
    updated_at = now()
WHERE session_id = '80773311-d26f-4092-a2f1-bfaf2eb2f6f7';

UPDATE public.patrol_sessions
SET status = 'scheduled',
    checkpoint_completed = 0,
    completed_required_count = 0,
    progress = 0,
    progress_percent = 0,
    actual_start = NULL,
    actual_end = NULL,
    first_scan_at = NULL,
    last_scan_at = NULL,
    meta = '{}'::jsonb,
    updated_at = now()
WHERE id = '80773311-d26f-4092-a2f1-bfaf2eb2f6f7';