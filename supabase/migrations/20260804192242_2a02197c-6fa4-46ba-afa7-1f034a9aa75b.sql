CREATE UNIQUE INDEX IF NOT EXISTS patrol_schedules_unique_active_recurrence
ON public.patrol_schedules (
  company_id,
  route_id,
  COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(device_identifier, ''),
  COALESCE(frequency_type, frequency),
  interval_value,
  COALESCE(start_time, '00:00'::time)
)
WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_patrol_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM public.patrol_schedules s
    WHERE s.id <> NEW.id
      AND s.status = 'active'
      AND s.company_id = NEW.company_id
      AND s.route_id = NEW.route_id
      AND COALESCE(s.site_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(NEW.site_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(s.device_identifier, '') = COALESCE(NEW.device_identifier, '')
      AND COALESCE(s.frequency_type, s.frequency) = COALESCE(NEW.frequency_type, NEW.frequency)
      AND s.interval_value = NEW.interval_value
      AND COALESCE(s.start_time, '00:00'::time) = COALESCE(NEW.start_time, '00:00'::time)
  ) THEN
    RAISE EXCEPTION 'An active schedule with the same route, site, device and recurrence already exists. Pause or edit the existing schedule instead of creating a duplicate.'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_active_patrol_schedule ON public.patrol_schedules;
CREATE TRIGGER trg_prevent_duplicate_active_patrol_schedule
BEFORE INSERT OR UPDATE ON public.patrol_schedules
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_active_patrol_schedule();