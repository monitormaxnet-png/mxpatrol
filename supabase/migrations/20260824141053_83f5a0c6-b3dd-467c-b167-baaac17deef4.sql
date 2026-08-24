-- Persist reusable patrol-template operating rules without merging route or schedule data.
-- Template = patrol identity + expected duration + supported execution rules.
-- Route remains the checkpoint sequence. Schedule remains the timing/frequency.

ALTER TABLE public.patrol_templates
  ADD COLUMN IF NOT EXISTS operational_rules jsonb;

ALTER TABLE public.patrol_templates
  ALTER COLUMN operational_rules SET DEFAULT jsonb_build_object(
    'checkpoints_required', true,
    'sequential_scanning', false,
    'expected_duration_enforced', true,
    'missed_checkpoints_recorded', true,
    'late_start_tracking', true,
    'incomplete_patrol_tracking', true,
    'offline_scans_allowed', true
  );

UPDATE public.patrol_templates
SET operational_rules = jsonb_build_object(
  'checkpoints_required', COALESCE((operational_rules->>'checkpoints_required')::boolean, true),
  'sequential_scanning', COALESCE((operational_rules->>'sequential_scanning')::boolean, false),
  'expected_duration_enforced', COALESCE((operational_rules->>'expected_duration_enforced')::boolean, true),
  'missed_checkpoints_recorded', COALESCE((operational_rules->>'missed_checkpoints_recorded')::boolean, true),
  'late_start_tracking', COALESCE((operational_rules->>'late_start_tracking')::boolean, true),
  'incomplete_patrol_tracking', COALESCE((operational_rules->>'incomplete_patrol_tracking')::boolean, true),
  'offline_scans_allowed', COALESCE((operational_rules->>'offline_scans_allowed')::boolean, true)
)
WHERE operational_rules IS NULL
   OR NOT (operational_rules ? 'checkpoints_required')
   OR NOT (operational_rules ? 'expected_duration_enforced')
   OR NOT (operational_rules ? 'missed_checkpoints_recorded')
   OR NOT (operational_rules ? 'late_start_tracking')
   OR NOT (operational_rules ? 'incomplete_patrol_tracking')
   OR NOT (operational_rules ? 'offline_scans_allowed');

ALTER TABLE public.patrol_templates
  ALTER COLUMN operational_rules SET NOT NULL;

ALTER TABLE public.patrol_templates
  DROP CONSTRAINT IF EXISTS patrol_templates_operational_rules_object;

ALTER TABLE public.patrol_templates
  ADD CONSTRAINT patrol_templates_operational_rules_object
  CHECK (jsonb_typeof(operational_rules) = 'object');