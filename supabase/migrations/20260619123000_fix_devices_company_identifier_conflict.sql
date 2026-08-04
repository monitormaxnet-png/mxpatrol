-- Fix PostgREST/Supabase upsert conflict inference for:
-- devices.upsert(..., { onConflict: 'company_id,device_identifier' })
-- This should be applied before adding scan_logs triggers that depend on device presence working.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS device_identifier text;

CREATE TABLE IF NOT EXISTS public.devices_dedup_backup_20260624 AS
SELECT *
FROM public.devices
WHERE false;

INSERT INTO public.devices_dedup_backup_20260624
SELECT d.*
FROM public.devices d
WHERE d.device_identifier IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.devices duplicate
    WHERE duplicate.company_id = d.company_id
      AND duplicate.device_identifier IS NOT DISTINCT FROM d.device_identifier
      AND duplicate.device_identifier IS NOT NULL
      AND duplicate.id <> d.id
  )
ON CONFLICT DO NOTHING;

WITH ranked_duplicate_devices AS (
  SELECT
    d.*,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, device_identifier
      ORDER BY
        updated_at DESC NULLS LAST,
        last_seen_at DESC NULLS LAST,
        registration_date DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS duplicate_rank,
    FIRST_VALUE(id) OVER (
      PARTITION BY company_id, device_identifier
      ORDER BY
        updated_at DESC NULLS LAST,
        last_seen_at DESC NULLS LAST,
        registration_date DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS survivor_id
  FROM public.devices d
  WHERE device_identifier IS NOT NULL
), duplicate_rollups AS (
  SELECT
    survivor_id,
    MAX(current_gps_lat) FILTER (WHERE current_gps_at IS NOT NULL) AS current_gps_lat,
    MAX(current_gps_lng) FILTER (WHERE current_gps_at IS NOT NULL) AS current_gps_lng,
    MAX(current_gps_accuracy) FILTER (WHERE current_gps_at IS NOT NULL) AS current_gps_accuracy,
    MAX(current_gps_at) AS current_gps_at,
    MAX(battery_level) FILTER (WHERE battery_level IS NOT NULL) AS battery_level,
    MAX(last_seen_at) AS last_seen_at,
    MAX(user_id::text)::uuid FILTER (WHERE user_id IS NOT NULL) AS user_id,
    MAX(guard_id::text)::uuid FILTER (WHERE guard_id IS NOT NULL) AS guard_id,
    jsonb_object_agg(id::text, metadata) FILTER (WHERE metadata IS NOT NULL) AS duplicate_metadata
  FROM ranked_duplicate_devices
  GROUP BY survivor_id
  HAVING COUNT(*) > 1
)
UPDATE public.devices survivor
SET
  current_gps_lat = COALESCE(survivor.current_gps_lat, duplicate_rollups.current_gps_lat),
  current_gps_lng = COALESCE(survivor.current_gps_lng, duplicate_rollups.current_gps_lng),
  current_gps_accuracy = COALESCE(survivor.current_gps_accuracy, duplicate_rollups.current_gps_accuracy),
  current_gps_at = GREATEST(survivor.current_gps_at, duplicate_rollups.current_gps_at),
  battery_level = COALESCE(survivor.battery_level, duplicate_rollups.battery_level),
  last_seen_at = GREATEST(survivor.last_seen_at, duplicate_rollups.last_seen_at),
  user_id = COALESCE(survivor.user_id, duplicate_rollups.user_id),
  guard_id = COALESCE(survivor.guard_id, duplicate_rollups.guard_id),
  metadata = COALESCE(survivor.metadata, '{}'::jsonb)
    || jsonb_build_object('deduped_device_rows_backup_table', 'devices_dedup_backup_20260624')
    || jsonb_build_object('duplicate_device_metadata_by_id', COALESCE(duplicate_rollups.duplicate_metadata, '{}'::jsonb))
FROM duplicate_rollups
WHERE survivor.id = duplicate_rollups.survivor_id;

WITH ranked_duplicate_devices AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, device_identifier
      ORDER BY
        updated_at DESC NULLS LAST,
        last_seen_at DESC NULLS LAST,
        registration_date DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS duplicate_rank
  FROM public.devices
  WHERE device_identifier IS NOT NULL
)
DELETE FROM public.devices d
USING ranked_duplicate_devices ranked
WHERE d.ctid = ranked.ctid
  AND ranked.duplicate_rank > 1;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_company_identifier_unique;

DROP INDEX IF EXISTS public.devices_company_identifier_unique;
DROP INDEX IF EXISTS public.idx_devices_company_identifier_unique;
DROP INDEX IF EXISTS public.devices_company_identifier_unique_idx;

CREATE UNIQUE INDEX devices_company_identifier_unique_idx
  ON public.devices(company_id, device_identifier);

ALTER TABLE public.devices
  ADD CONSTRAINT devices_company_identifier_unique
  UNIQUE USING INDEX devices_company_identifier_unique_idx;

NOTIFY pgrst, 'reload schema';
