-- Resolve pending NFC tag decisions atomically so checkpoints, scans, alerts,
-- and audit history cannot drift apart when one client-side write fails.

CREATE OR REPLACE FUNCTION public.review_pending_nfc_tag(
  p_pending_tag_id uuid,
  p_decision text,
  p_checkpoint_name text DEFAULT NULL,
  p_rejection_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending public.pending_nfc_tags%ROWTYPE;
  v_checkpoint_id uuid;
  v_reviewed_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;

  SELECT *
  INTO v_pending
  FROM public.pending_nfc_tags
  WHERE id = p_pending_tag_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_pending.company_id <> public.get_user_company_id(auth.uid())
    OR NOT (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  THEN
    RAISE EXCEPTION 'Pending NFC tag not found or access denied';
  END IF;

  IF v_pending.status <> 'pending' THEN
    RAISE EXCEPTION 'NFC tag has already been reviewed as %', v_pending.status;
  END IF;

  IF p_decision = 'approved' THEN
    SELECT id
    INTO v_checkpoint_id
    FROM public.checkpoints
    WHERE company_id = v_pending.company_id
      AND regexp_replace(lower(nfc_tag_id), '[^a-z0-9]', '', 'g') = v_pending.tag_uid
    ORDER BY created_at
    LIMIT 1;

    IF v_checkpoint_id IS NULL THEN
      INSERT INTO public.checkpoints (
        company_id,
        name,
        nfc_tag_id,
        location_lat,
        location_lng,
        sort_order
      )
      VALUES (
        v_pending.company_id,
        COALESCE(NULLIF(btrim(p_checkpoint_name), ''), 'Checkpoint ' || right(v_pending.tag_uid, 6)),
        v_pending.tag_uid,
        v_pending.gps_lat,
        v_pending.gps_lng,
        COALESCE((SELECT max(sort_order) + 1 FROM public.checkpoints WHERE company_id = v_pending.company_id), 0)
      )
      RETURNING id INTO v_checkpoint_id;
    END IF;

    UPDATE public.scan_logs
    SET checkpoint_id = v_checkpoint_id,
        tag_status = 'registered'
    WHERE company_id = v_pending.company_id
      AND checkpoint_id IS NULL
      AND regexp_replace(lower(COALESCE(tag_uid, '')), '[^a-z0-9]', '', 'g') = v_pending.tag_uid;
  ELSE
    UPDATE public.scan_logs
    SET tag_status = 'rejected'
    WHERE company_id = v_pending.company_id
      AND checkpoint_id IS NULL
      AND regexp_replace(lower(COALESCE(tag_uid, '')), '[^a-z0-9]', '', 'g') = v_pending.tag_uid;
  END IF;

  UPDATE public.pending_nfc_tags
  SET status = p_decision,
      checkpoint_id = v_checkpoint_id,
      reviewed_by = auth.uid(),
      reviewed_at = v_reviewed_at,
      rejection_reason = CASE WHEN p_decision = 'rejected' THEN NULLIF(btrim(p_rejection_reason), '') ELSE NULL END
  WHERE id = v_pending.id;

  UPDATE public.alerts AS alert
  SET is_read = true
  WHERE alert.company_id = v_pending.company_id
    AND (
      alert.id = v_pending.alert_id
      OR EXISTS (
        SELECT 1
        FROM public.nfc_tag_audit_logs AS audit
        WHERE audit.company_id = v_pending.company_id
          AND audit.tag_uid = v_pending.tag_uid
          AND audit.metadata->>'alert_id' = alert.id::text
      )
    );

  INSERT INTO public.nfc_tag_audit_logs (
    company_id,
    pending_tag_id,
    scan_log_id,
    checkpoint_id,
    tag_uid,
    action,
    performed_by,
    gps_lat,
    gps_lng,
    device_id,
    device_identifier,
    metadata
  )
  VALUES (
    v_pending.company_id,
    v_pending.id,
    v_pending.scan_log_id,
    v_checkpoint_id,
    v_pending.tag_uid,
    p_decision,
    auth.uid(),
    v_pending.gps_lat,
    v_pending.gps_lng,
    v_pending.device_id,
    v_pending.device_identifier,
    jsonb_build_object('rejection_reason', p_rejection_reason)
  );

  RETURN jsonb_build_object(
    'pending_tag_id', v_pending.id,
    'status', p_decision,
    'checkpoint_id', v_checkpoint_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_pending_nfc_tag(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_pending_nfc_tag(uuid, text, text, text) TO authenticated;
