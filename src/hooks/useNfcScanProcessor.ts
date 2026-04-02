import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOfflineScanQueue } from "@/hooks/useOfflineScanQueue";
import { toast } from "sonner";

export type ScanValidationResult = {
  valid: boolean;
  checkpoint?: { id: string; name: string; nfc_tag_id: string };
  reason?: string;
};

type ProcessorOptions = {
  checkpoints: Array<{ id: string; name: string; nfc_tag_id: string; patrol_id: string | null }>;
  selectedGuardId: string;
  companyId: string | null;
  isOnline: boolean;
  onSuccess?: (result: ScanValidationResult) => void;
  onFailure?: (result: ScanValidationResult) => void;
};

export function useNfcScanProcessor({
  checkpoints,
  selectedGuardId,
  companyId,
  isOnline,
  onSuccess,
  onFailure,
}: ProcessorOptions) {
  const { user } = useAuth();
  const { enqueue } = useOfflineScanQueue();
  const recentScansRef = useRef<Map<string, number>>(new Map());

  const validateTag = useCallback(
    (tagId: string): ScanValidationResult => {
      // Normalize tag ID comparison (case-insensitive, trimmed)
      const normalizedTag = tagId.toLowerCase().replace(/:/g, "").trim();

      const checkpoint = checkpoints.find((cp) => {
        const cpTag = cp.nfc_tag_id.toLowerCase().replace(/:/g, "").trim();
        return cpTag === normalizedTag;
      });

      if (!checkpoint) {
        return { valid: false, reason: "Unknown NFC tag — not registered in checkpoint database" };
      }

      // Duplicate scan check (within 60 seconds)
      const lastScan = recentScansRef.current.get(checkpoint.id);
      if (lastScan && Date.now() - lastScan < 60_000) {
        return {
          valid: false,
          checkpoint,
          reason: "Duplicate scan — this checkpoint was scanned less than 1 minute ago",
        };
      }

      if (!selectedGuardId) {
        return { valid: false, checkpoint, reason: "No guard selected for this scan session" };
      }

      if (!companyId) {
        return { valid: false, checkpoint, reason: "Company not configured" };
      }

      return { valid: true, checkpoint };
    },
    [checkpoints, selectedGuardId, companyId]
  );

  const processScan = useCallback(
    async (tagId: string, gps: { lat: number; lng: number } | null) => {
      const result = validateTag(tagId);

      if (!result.valid || !result.checkpoint) {
        onFailure?.(result);
        return result;
      }

      // Record in recent scans to prevent duplicates
      recentScansRef.current.set(result.checkpoint.id, Date.now());

      const scanData = {
        guard_id: selectedGuardId,
        checkpoint_id: result.checkpoint.id,
        company_id: companyId!,
        scanned_at: new Date().toISOString(),
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
      };

      if (!isOnline) {
        enqueue(scanData);
        toast.info("Scan saved offline — will sync when connected");
        onSuccess?.(result);
        return result;
      }

      try {
        const { error } = await supabase.from("scan_logs").insert({
          ...scanData,
          is_offline_sync: false,
        });

        if (error) throw error;
        onSuccess?.(result);
      } catch (err: any) {
        // Fallback to offline queue on network error
        enqueue(scanData);
        toast.warning("Network error — scan saved offline");
        onSuccess?.(result);
      }

      return result;
    },
    [validateTag, selectedGuardId, companyId, isOnline, enqueue, onSuccess, onFailure]
  );

  return { processScan, validateTag };
}
