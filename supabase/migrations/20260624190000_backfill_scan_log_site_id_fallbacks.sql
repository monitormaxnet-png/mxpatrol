-- Backfill scan_logs.site_id for scans saved while PostgREST schema cache did not expose site_id.
-- Keep site_id_schema_cache_fallback=true as a historical marker; add site_id_backfilled_at when repaired.

WITH fallback_targets AS (
  SELECT
    sl.id,
    COALESCE(
      NULLIF(sl.device_metadata->>'intended_site_id', '')::uuid,
      cp.site_id,
      d.site_id
    ) AS resolved_site_id
  FROM public.scan_logs sl
  LEFT JOIN public.checkpoints cp
    ON cp.id = sl.checkpoint_id
   AND cp.company_id = sl.company_id
  LEFT JOIN public.devices d
    ON d.company_id = sl.company_id
   AND d.device_identifier = sl.device_identifier
  WHERE sl.site_id IS NULL
    AND sl.device_metadata->>'site_id_schema_cache_fallback' = 'true'
)
UPDATE public.scan_logs sl
SET
  site_id = fallback_targets.resolved_site_id,
  device_metadata = COALESCE(sl.device_metadata, '{}'::jsonb)
    || jsonb_build_object('site_id_backfilled_at', now())
FROM fallback_targets
WHERE sl.id = fallback_targets.id
  AND fallback_targets.resolved_site_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
