import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { findCheckpointForNfcTag } from "@/lib/nfcWorkflow";
import { saveDeviceScan } from "@/lib/deviceScan";
import { normalizeNfcUid } from "@/lib/nfcUid";
import { playFeedbackSound } from "@/lib/feedbackSound";

export type QueuedScan = {
  id: string;
  guard_id: string | null;
  checkpoint_id: string | null;
  company_id: string;
  site_id?: string | null;
  scanned_at: string;
  tag_uid?: string | null;
  tag_status?: "registered" | "unregistered" | "pending_registration" | "rejected";
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy?: number | null;
  scanned_by?: string | null;
  user_id?: string | null;
  device_id?: string | null;
  device_identifier?: string | null;
  device_metadata?: Record<string, unknown>;
  face_verified?: boolean | null;
  face_confidence?: number | null;
  guard_name?: string | null;
};

const STORAGE_KEY = "offline_scan_queue";
const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

function loadQueue(): QueuedScan[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedScan[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function useOfflineScanQueue() {
  const [queue, setQueue] = useState<QueuedScan[]>(loadQueue);
  const [syncing, setSyncing] = useState(false);

  const enqueue = useCallback((scan: Omit<QueuedScan, "id">) => {
    const entry: QueuedScan = { ...scan, id: crypto.randomUUID() };
    setQueue((prev) => {
      const next = [...prev, entry];
      saveQueue(next);
      return next;
    });
  }, []);

  const syncQueue = useCallback(async () => {
    const pending = loadQueue();
    if (pending.length === 0 || !navigator.onLine) return;

    setSyncing(true);
    const failed: QueuedScan[] = [];

    for (const scan of pending) {
      try {
        const normalizedTagUid = scan.tag_uid ? normalizeNfcUid(scan.tag_uid) : null;
        let checkpointId = scan.checkpoint_id;
        let siteId = scan.site_id ?? null;
        let tagStatus = scan.tag_status ?? "registered";

        if (!checkpointId && (tagStatus === "unregistered" || tagStatus === "pending_registration") && normalizedTagUid) {
          const checkpoint = await findCheckpointForNfcTag(scan.company_id, normalizedTagUid);

          if (checkpoint) {
            checkpointId = checkpoint.id;
            siteId = checkpoint.site_id ?? siteId;
            tagStatus = "registered";
          } else {
            const { data: reviewedTags, error: reviewedTagError } = await supabase
              .from("pending_nfc_tags")
              .select("status")
              .eq("company_id", scan.company_id)
              .eq("tag_uid", normalizedTagUid)
              .neq("status", "pending")
              .order("last_seen_at", { ascending: false })
              .limit(1);
            if (reviewedTagError) throw reviewedTagError;
            if (reviewedTags?.[0]?.status === "rejected") tagStatus = "rejected";
          }
        }
        const savedScan = await saveDeviceScan({
          id: scan.id,
          guard_id: scan.guard_id,
          checkpoint_id: checkpointId,
          company_id: scan.company_id,
          site_id: siteId,
          scanned_at: scan.scanned_at,
          tag_uid: normalizedTagUid,
          tag_status: tagStatus,
          gps_lat: scan.gps_lat,
          gps_lng: scan.gps_lng,
          gps_accuracy: scan.gps_accuracy ?? null,
          scanned_by: scan.scanned_by ?? null,
          user_id: scan.user_id ?? scan.scanned_by ?? null,
          device_id: scan.device_id ?? null,
          device_identifier: scan.device_identifier ?? null,
          device_metadata: scan.device_metadata ?? {},
          face_verified: scan.face_verified ?? null,
          face_confidence: scan.face_confidence ?? null,
          is_offline_sync: true,
        });

        console.info("[Scan] Inserted into scan_logs", {
          source: "offline-sync",
          companyId: scan.company_id,
          siteId,
          tagUid: normalizedTagUid,
          checkpointId: savedScan.checkpoint?.id ?? checkpointId,
          deviceIdentifier: scan.device_identifier ?? scan.device_id ?? null,
          latitude: scan.gps_lat,
          longitude: scan.gps_lng,
          scannedAt: scan.scanned_at,
        });      } catch (error) {
        console.warn(`[OfflineScanQueue] Scan sync failed ${describeError(error)}`);
        failed.push(scan);
      }
    }

    saveQueue(failed);
    setQueue(failed);
    setSyncing(false);

    const synced = pending.length - failed.length;
    if (synced > 0) {
      playFeedbackSound("sync-complete");
      toast.success(`Synced ${synced} offline scan${synced > 1 ? "s" : ""}`);
    }
    if (failed.length > 0) {
      playFeedbackSound("error");
      toast.error(`${failed.length} scan${failed.length > 1 ? "s" : ""} failed to sync`);
    }
  }, []);

  // Auto-sync when coming back online
  useEffect(() => {
    const handler = () => syncQueue();
    window.addEventListener("online", handler);
    // Also try on mount
    syncQueue();
    return () => window.removeEventListener("online", handler);
  }, [syncQueue]);

  return { queue, enqueue, syncQueue, syncing, pendingCount: queue.length };
}
