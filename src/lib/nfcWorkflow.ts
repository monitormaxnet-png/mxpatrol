import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getPatrolDeviceInfo, type PatrolDeviceInfo } from "@/lib/deviceInfo";
import { normalizeNfcUid } from "@/lib/nfcUid";

export type NfcScanGps = {
  lat: number;
  lng: number;
  accuracy?: number | null;
} | null;

export type UnknownNfcTagInput = {
  tagId: string;
  companyId: string;
  guardId: string | null;
  guardName?: string | null;
  performedBy: string | null;
  scanLogId: string | null;
  scannedAt: string;
  gps: NfcScanGps;
  device?: PatrolDeviceInfo;
  metadata?: Record<string, unknown>;
};

export type NfcGpsBackfillInput = {
  companyId: string;
  scanLogId: string;
  tagId: string;
  gps: Exclude<NfcScanGps, null>;
};

export type CheckpointGpsBackfillInput = {
  companyId: string;
  checkpointId: string | null | undefined;
  gps: NfcScanGps;
};

export async function backfillCheckpointGpsFromScan({
  companyId,
  checkpointId,
  gps,
}: CheckpointGpsBackfillInput) {
  if (!checkpointId || !gps) return false;

  const { error, count } = await supabase
    .from("checkpoints")
    .update({ location_lat: gps.lat, location_lng: gps.lng })
    .eq("id", checkpointId)
    .eq("company_id", companyId)
    .or("location_lat.is.null,location_lng.is.null");

  if (error) throw error;
  return (count ?? 0) > 0;
}

export type PendingNfcTagDecision = "approved" | "rejected";

export async function findCheckpointForNfcTag(companyId: string, tagId: string) {
  const normalizedTagId = normalizeNfcUid(tagId);
  if (!normalizedTagId) return null;

  const { data: exactCheckpoint, error: exactError } = await supabase
    .from("checkpoints")
    .select("id, nfc_tag_id, site_id")
    .eq("company_id", companyId)
    .eq("nfc_tag_id", normalizedTagId)
    .maybeSingle();

  if (exactError) throw exactError;
  if (exactCheckpoint) return exactCheckpoint;

  // Older checkpoints may predate UID normalization and still contain
  // separators or uppercase characters.
  const { data: companyCheckpoints, error: fallbackError } = await supabase
    .from("checkpoints")
    .select("id, nfc_tag_id, site_id")
    .eq("company_id", companyId);

  if (fallbackError) throw fallbackError;
  return companyCheckpoints?.find((checkpoint) => normalizeNfcUid(checkpoint.nfc_tag_id) === normalizedTagId) ?? null;
}

export async function reviewPendingNfcTag({
  pendingTagId,
  decision,
  checkpointName,
  rejectionReason,
}: {
  pendingTagId: string;
  decision: PendingNfcTagDecision;
  checkpointName?: string;
  rejectionReason?: string;
}) {
  const { data, error } = await supabase.rpc("review_pending_nfc_tag", {
    p_pending_tag_id: pendingTagId,
    p_decision: decision,
    p_checkpoint_name: checkpointName ?? null,
    p_rejection_reason: rejectionReason ?? null,
  });

  if (error) {
    const message = error.message || error.details || error.hint || "Failed to review pending NFC tag";
    throw new Error(message);
  }
  return data;
}

async function reconcileReviewedTag({
  companyId,
  tagId,
  scanLogId,
}: {
  companyId: string;
  tagId: string;
  scanLogId: string | null;
}) {
  if (!scanLogId) return false;

  const normalizedTagId = normalizeNfcUid(tagId);
  const checkpoint = await findCheckpointForNfcTag(companyId, normalizedTagId);

  if (checkpoint) {
    const { error } = await supabase
      .from("scan_logs")
      .update({ checkpoint_id: checkpoint.id, site_id: checkpoint.site_id ?? null, tag_status: "registered" } as never)
      .eq("id", scanLogId)
      .eq("company_id", companyId);
    if (error) throw error;
    return true;
  }

  const { data: reviewedTags, error: reviewedTagError } = await supabase
    .from("pending_nfc_tags")
    .select("status")
    .eq("company_id", companyId)
    .eq("tag_uid", normalizedTagId)
    .neq("status", "pending")
    .order("last_seen_at", { ascending: false })
    .limit(1);

  if (reviewedTagError) throw reviewedTagError;
  const reviewedTag = reviewedTags?.[0];
  if (!reviewedTag) return false;

  const { error } = await supabase
    .from("scan_logs")
    .update({ tag_status: reviewedTag.status === "approved" ? "registered" : "rejected" } as never)
    .eq("id", scanLogId)
    .eq("company_id", companyId);
  if (error) throw error;
  return true;
}

export const buildUnknownNfcTagAlertMessage = ({
  tagId,
  guardName,
  scannedAt,
  gps,
}: Pick<UnknownNfcTagInput, "tagId" | "guardName" | "scannedAt" | "gps">) => {
  const gpsText = gps ? `${gps.lat},${gps.lng}` : "Pending";

  return [
    "New NFC Tag Detected",
    "",
    `Tag UID: ${tagId}`,
    `Guard: ${guardName || "Unassigned"}`,
    `Date/Time: ${new Date(scannedAt).toLocaleString()}`,
    `GPS: ${gpsText}`,
    "",
    "Would you like to register this tag as a checkpoint?",
    "",
    "Approve Registration | Ignore",
  ].join("\n");
};

export async function recordUnknownNfcTag({
  tagId,
  companyId,
  guardId,
  guardName,
  performedBy,
  scanLogId,
  scannedAt,
  gps,
  device = getPatrolDeviceInfo(),
  metadata = {},
}: UnknownNfcTagInput) {
  const normalizedTagId = normalizeNfcUid(tagId);
  if (await reconcileReviewedTag({ companyId, tagId: normalizedTagId, scanLogId })) return;

  const message = buildUnknownNfcTagAlertMessage({ tagId: normalizedTagId, guardName, scannedAt, gps });

  const { data: alert, error: alertError } = await supabase
    .from("alerts")
    .insert({
      company_id: companyId,
      type: "anomaly",
      severity: "medium",
      guard_id: guardId,
      message,
    })
    .select("id")
    .single();

  if (alertError) {
    console.warn("[NFC] Pending tag alert insert failed; continuing pending tag sync", alertError);
  }

  const { data: pendingTag, error: pendingError } = await supabase
    .from("pending_nfc_tags")
    .upsert(
      {
        company_id: companyId,
        tag_uid: normalizedTagId,
        last_seen_at: scannedAt,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        gps_accuracy: gps?.accuracy ?? null,
        device_id: device.deviceId,
        device_identifier: device.deviceIdentifier,
        device_metadata: device.metadata as Json,
        scan_log_id: scanLogId,
        alert_id: alert?.id ?? null,
        metadata: metadata as Json,
      },
      { onConflict: "company_id,tag_uid" }
    )
    .select("id, status")
    .single();

  if (pendingError) throw pendingError;

  // A review may have committed between the initial reconciliation check and
  // this upsert. Close the just-created alert and apply that decision instead
  // of leaving an unread alert for a tag that is no longer pending.
  if (pendingTag.status !== "pending") {
    if (alert?.id) {
      const { error: resolvedAlertError } = await supabase
        .from("alerts")
        .update({ is_read: true })
        .eq("id", alert.id)
        .eq("company_id", companyId);
      if (resolvedAlertError) throw resolvedAlertError;
    }

    await reconcileReviewedTag({ companyId, tagId: normalizedTagId, scanLogId });
    return;
  }

  const { error: auditError } = await supabase.from("nfc_tag_audit_logs").insert({
    company_id: companyId,
    pending_tag_id: pendingTag?.id ?? null,
    scan_log_id: scanLogId,
    tag_uid: normalizedTagId,
    nfc_tag_id: normalizedTagId,
    action: "pending_created",
    performed_by: performedBy,
    actor_user_id: performedBy,
    actor_guard_id: guardId,
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    device_id: device.deviceId,
    device_identifier: device.deviceIdentifier,
    metadata: { alert_id: alert?.id ?? null, ...metadata } as Json,
  });

  if (auditError) throw auditError;
}

export async function backfillNfcScanGps({
  companyId,
  scanLogId,
  tagId,
  gps,
}: NfcGpsBackfillInput) {
  const normalizedTagId = normalizeNfcUid(tagId);
  const gpsUpdate = {
    gps_lat: gps.lat,
    gps_lng: gps.lng,
    gps_accuracy: gps.accuracy ?? null,
  };

  const { error: scanLogError } = await supabase
    .from("scan_logs")
    .update(gpsUpdate)
    .eq("id", scanLogId)
    .eq("company_id", companyId);

  if (scanLogError) throw scanLogError;

  const { error: pendingTagError } = await supabase
    .from("pending_nfc_tags")
    .update(gpsUpdate)
    .eq("company_id", companyId)
    .eq("tag_uid", normalizedTagId)
    .eq("scan_log_id", scanLogId);

  if (pendingTagError) throw pendingTagError;
}
