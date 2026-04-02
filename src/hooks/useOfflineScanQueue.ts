import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type QueuedScan = {
  id: string;
  guard_id: string;
  checkpoint_id: string;
  company_id: string;
  scanned_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
};

const STORAGE_KEY = "offline_scan_queue";

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
      const { error } = await supabase.from("scan_logs").insert({
        guard_id: scan.guard_id,
        checkpoint_id: scan.checkpoint_id,
        company_id: scan.company_id,
        scanned_at: scan.scanned_at,
        gps_lat: scan.gps_lat,
        gps_lng: scan.gps_lng,
        is_offline_sync: true,
      });
      if (error) failed.push(scan);
    }

    saveQueue(failed);
    setQueue(failed);
    setSyncing(false);

    const synced = pending.length - failed.length;
    if (synced > 0) toast.success(`Synced ${synced} offline scan${synced > 1 ? "s" : ""}`);
    if (failed.length > 0) toast.error(`${failed.length} scan${failed.length > 1 ? "s" : ""} failed to sync`);
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
