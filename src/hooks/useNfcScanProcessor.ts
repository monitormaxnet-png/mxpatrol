import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOfflineScanQueue, type QueuedScan } from "@/hooks/useOfflineScanQueue";
import { toast } from "sonner";
import { getPatrolDeviceInfo } from "@/lib/deviceInfo";
import { saveDeviceScan } from "@/lib/deviceScan";
import { normalizeNfcUid } from "@/lib/nfcUid";

export type ScanValidationResult = {
  valid: boolean;
  checkpoint?: { id: string; name: string; nfc_tag_id: string; patrol_id?: string | null; site_id?: string | null };
  checkpointName?: string;
  scanLogId?: string;
  tagId?: string;
  tagStatus?: "registered" | "unregistered" | "pending_registration" | "rejected";
  reason?: string;
  requiresFaceVerification?: boolean;
};

type ScanGps = { lat: number; lng: number; accuracy?: number | null } | null;
type QueuedScanInput = Omit<QueuedScan, "id">;

type ProcessorOptions = {
  checkpoints: Array<{ id: string; name: string; nfc_tag_id: string; patrol_id: string | null; site_id?: string | null }>;
  patrols: Array<{ id: string; verification_level?: string }>;
  selectedGuardId: string | null;
  guardName?: string | null;
  deviceMetadata?: Record<string, unknown>;
  companyId: string | null;
  isOnline: boolean;
  onSuccess?: (result: ScanValidationResult) => void;
  onFailure?: (result: ScanValidationResult) => void;
  onFaceVerificationRequired?: (result: ScanValidationResult, scanData: QueuedScanInput) => void;
};

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function useNfcScanProcessor({
  checkpoints,
  patrols,
  selectedGuardId,
  guardName,
  deviceMetadata,
  companyId,
  isOnline,
  onSuccess,
  onFailure,
  onFaceVerificationRequired,
}: ProcessorOptions) {
  const { user } = useAuth();
  const { enqueue } = useOfflineScanQueue();
  const recentScansRef = useRef<Map<string, number>>(new Map());

  const validateTag = useCallback(
    (tagId: string): ScanValidationResult => {
      const normalizedTag = normalizeNfcUid(tagId);
      const checkpointLookupField = "checkpoints.nfc_tag_id";
      const normalizedCheckpoints = checkpoints.map((cp) => ({
        id: cp.id,
        name: cp.name,
        nfc_tag_id: cp.nfc_tag_id,
        normalized_nfc_tag_id: normalizeNfcUid(cp.nfc_tag_id),
      }));
      const checkpoint = checkpoints.find((cp) => normalizeNfcUid(cp.nfc_tag_id) === normalizedTag);

      console.debug(`[NFCScanner] checkpoint lookup ${safeStringify({
        rawScannedUid: tagId,
        normalizedScannedUid: normalizedTag,
        checkpointLookupField,
        checkpointCount: checkpoints.length,
        normalizedCheckpoints,
        checkpointLookupResult: checkpoint
          ? { id: checkpoint.id, name: checkpoint.name, nfc_tag_id: checkpoint.nfc_tag_id }
          : null,
      })}`);

      if (!companyId) {
        return {
          valid: false,
          checkpoint,
          checkpointName: checkpoint?.name,
          tagId: normalizedTag || tagId,
          tagStatus: checkpoint ? "registered" : "unregistered",
          reason: "Company not configured",
        };
      }

      const scanKey = checkpoint?.id ?? normalizedTag;
      const lastScan = recentScansRef.current.get(scanKey);
      if (lastScan && Date.now() - lastScan < 60_000) {
        return {
          valid: false,
          checkpoint,
          checkpointName: checkpoint?.name,
          tagId: normalizedTag || tagId,
          tagStatus: checkpoint ? "registered" : "unregistered",
          reason: "Duplicate scan recorded less than 1 minute ago",
        };
      }

      return {
        valid: true,
        checkpoint,
        checkpointName: checkpoint?.name,
        tagId: normalizedTag || tagId,
        tagStatus: checkpoint ? "registered" : "unregistered",
      };
    },
    [checkpoints, companyId]
  );

  const processScan = useCallback(
    async (tagId: string, gps: ScanGps, faceResult?: { verified: boolean; confidence: number }) => {
      const result = validateTag(tagId);

      if (!result.valid) {
        onFailure?.(result);
        return result;
      }

      const patrol = result.checkpoint?.patrol_id
        ? patrols.find((p) => p.id === result.checkpoint!.patrol_id)
        : null;
      const requiresFace = patrol?.verification_level === "enhanced";
      const device = getPatrolDeviceInfo();

      const scanData: QueuedScanInput = {
        guard_id: selectedGuardId,
        guard_name: guardName ?? null,
        scanned_by: user?.id ?? null,
        user_id: user?.id ?? null,
        checkpoint_id: result.checkpoint?.id ?? null,
        company_id: companyId!,
        site_id: result.checkpoint?.site_id ?? null,
        scanned_at: new Date().toISOString(),
        tag_uid: result.tagId ?? normalizeNfcUid(tagId),
        tag_status: result.tagStatus ?? "registered",
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        gps_accuracy: gps?.accuracy ?? null,
        device_id: device.deviceId,
        device_identifier: device.deviceIdentifier,
        device_metadata: {
          ...device.metadata,
          ...deviceMetadata,
        },
        face_verified: faceResult?.verified ?? null,
        face_confidence: faceResult?.confidence ?? null,
      };

      if (requiresFace && !faceResult && onFaceVerificationRequired && result.checkpoint) {
        recentScansRef.current.set(result.checkpoint.id, Date.now());
        result.requiresFaceVerification = true;
        onFaceVerificationRequired(result, scanData);
        return result;
      }

      recentScansRef.current.set(result.checkpoint?.id ?? result.tagId ?? tagId, Date.now());

      if (!isOnline) {
        enqueue(scanData);
        toast.info("Scan saved offline. It will sync when connected.");
        onSuccess?.(result);
        return result;
      }

      try {
        const { guard_name: _guardName, ...scanLogData } = scanData;
        const savedScan = await saveDeviceScan({
          ...scanLogData,
          is_offline_sync: false,
        });

        console.info("[DeviceScan] server result", {
          scanLogId: savedScan.scanLogId ?? null,
          checkpointId: savedScan.checkpoint?.id ?? null,
          checkpointName: savedScan.checkpoint?.name ?? null,
          siteId: savedScan.checkpoint?.site_id ?? null,
          tagStatus: savedScan.tagStatus ?? null,
        });

        result.scanLogId = savedScan.scanLogId ?? undefined;
        if (savedScan.checkpoint) {
          result.checkpoint = {
            id: savedScan.checkpoint.id,
            name: savedScan.checkpoint.name ?? "Checkpoint",
            nfc_tag_id: scanData.tag_uid ?? tagId,
            patrol_id: null,
            site_id: savedScan.checkpoint.site_id,
          };
          result.checkpointName = savedScan.checkpoint.name ?? "Registered checkpoint";
        }
        result.tagStatus = savedScan.tagStatus as ScanValidationResult["tagStatus"];
        if (result.tagStatus === "registered" && !result.checkpointName) {
          result.checkpointName = "Registered checkpoint";
        }

        console.info("[Scan] Inserted into scan_logs", {
          source: "live",
          companyId: scanData.company_id,
          siteId: scanData.site_id,
          tagUid: scanData.tag_uid,
          checkpointId: savedScan.checkpoint?.id ?? scanData.checkpoint_id,
          checkpointName: savedScan.checkpoint?.name ?? result.checkpointName ?? null,
          deviceIdentifier: scanData.device_identifier,
          latitude: scanData.gps_lat,
          longitude: scanData.gps_lng,
          scannedAt: scanData.scanned_at,
        });

        onSuccess?.(result);
      } catch (error) {
        console.error(`[NFCScanner] Supabase scan save failed ${safeStringify(error)}`);
        enqueue(scanData);
        const queuedResult: ScanValidationResult = {
          ...result,
          valid: false,
          reason: "Scan saved locally but Command Center did not receive it yet. Sync is queued.",
        };
        toast.warning("Scan saved locally, but Command Center did not receive it yet.");
        onFailure?.(queuedResult);
        return queuedResult;
      }

      return result;
    },
    [
      validateTag,
      patrols,
      selectedGuardId,
      user?.id,
      companyId,
      isOnline,
      enqueue,
      onSuccess,
      onFailure,
      onFaceVerificationRequired,
      guardName,
      deviceMetadata,
    ]
  );

  return { processScan, validateTag };
}
