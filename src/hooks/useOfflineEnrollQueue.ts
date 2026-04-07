import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type QueuedEnrollment = {
  id: string;
  qr_token: string;
  device_metadata: Record<string, unknown>;
  queued_at: string;
};

const STORAGE_KEY = "enroll_queue";

function loadQueue(): QueuedEnrollment[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return raw.map((item: any) => ({
      ...item,
      id: item.id || crypto.randomUUID(),
    }));
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedEnrollment[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function useOfflineEnrollQueue() {
  const [queue, setQueue] = useState<QueuedEnrollment[]>(loadQueue);
  const [syncing, setSyncing] = useState(false);

  const enqueue = useCallback((payload: { qr_token: string; device_metadata: Record<string, unknown> }) => {
    const entry: QueuedEnrollment = {
      ...payload,
      id: crypto.randomUUID(),
      queued_at: new Date().toISOString(),
    };
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
    const failed: QueuedEnrollment[] = [];

    for (const item of pending) {
      try {
        const { data, error } = await supabase.functions.invoke("device-enroll", {
          body: { qr_token: item.qr_token, device_metadata: item.device_metadata },
        });
        if (error || data?.error) {
          failed.push(item);
        }
      } catch {
        failed.push(item);
      }
    }

    saveQueue(failed);
    setQueue(failed);
    setSyncing(false);

    const synced = pending.length - failed.length;
    if (synced > 0) toast.success(`Synced ${synced} offline enrollment${synced > 1 ? "s" : ""}`);
    if (failed.length > 0) toast.error(`${failed.length} enrollment${failed.length > 1 ? "s" : ""} failed to sync`);
  }, []);

  // Auto-sync on mount and when coming back online
  useEffect(() => {
    const handler = () => syncQueue();
    window.addEventListener("online", handler);
    syncQueue();
    return () => window.removeEventListener("online", handler);
  }, [syncQueue]);

  return { queue, enqueue, syncQueue, syncing, pendingCount: queue.length };
}
