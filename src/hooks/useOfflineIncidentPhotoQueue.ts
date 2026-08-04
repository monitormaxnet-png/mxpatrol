import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type QueuedIncidentPhoto = {
  id: string;
  device_identifier: string;
  photo_base64: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  captured_at: string;
};

const DB_NAME = "mxpatrol_incident_photos";
const STORE_NAME = "queue";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGetAll(): Promise<QueuedIncidentPhoto[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as QueuedIncidentPhoto[]);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(entry: QueuedIncidentPhoto): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
};

export function useOfflineIncidentPhotoQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const all = await idbGetAll();
      setPendingCount(all.length);
    } catch {
      // IndexedDB unavailable; leave count as-is.
    }
  }, []);

  const enqueue = useCallback(async (photo: Omit<QueuedIncidentPhoto, "id">) => {
    const entry: QueuedIncidentPhoto = { ...photo, id: crypto.randomUUID() };
    try {
      await idbPut(entry);
      await refreshCount();
    } catch (error) {
      console.error("[IncidentPhotoQueue] Failed to enqueue " + describeError(error));
    }
  }, [refreshCount]);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return;

    let pending: QueuedIncidentPhoto[];
    try { pending = await idbGetAll(); } catch { return; }
    if (pending.length === 0) return;

    setSyncing(true);
    let syncedCount = 0;
    let failedCount = 0;

    for (const photo of pending) {
      try {
        const { data, error } = await supabase.functions.invoke("device-incident-photo", {
          body: {
            device_identifier: photo.device_identifier,
            photo_base64: photo.photo_base64,
            gps: photo.gps_lat != null && photo.gps_lng != null
              ? { lat: photo.gps_lat, lng: photo.gps_lng, accuracy: photo.gps_accuracy }
              : null,
            captured_at: photo.captured_at,
          },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Incident photo sync failed");

        await idbDelete(photo.id);
        syncedCount += 1;
        console.info("[IncidentPhotoQueue] Synced", { photoId: data.photo?.id ?? null });
      } catch (error) {
        console.warn(`[IncidentPhotoQueue] Sync failed ${describeError(error)}`);
        failedCount += 1;
      }
    }

    await refreshCount();
    setSyncing(false);
    if (syncedCount > 0) toast.success(`Synced ${syncedCount} incident photo${syncedCount > 1 ? "s" : ""}`);
    if (failedCount > 0) toast.error(`${failedCount} incident photo${failedCount > 1 ? "s" : ""} failed to sync`);
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
    const handler = () => syncQueue();
    window.addEventListener("online", handler);
    void syncQueue();
    return () => window.removeEventListener("online", handler);
  }, [refreshCount, syncQueue]);

  return { enqueue, syncQueue, syncing, pendingCount };
}
