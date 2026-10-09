import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type QueuedBiometricTestCapture = {
  id: string;
  device_identifier: string;
  event_type: "clock_in" | "clock_out";
  face_photo_base64: string;
  captured_at: string;
  idempotency_key: string;
  source_event_id?: string | null;
  test_session_id?: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
};

const DB_NAME = "mxpatrol_biometric_test_captures";
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

async function idbGetAll(): Promise<QueuedBiometricTestCapture[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as QueuedBiometricTestCapture[]);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(entry: QueuedBiometricTestCapture): Promise<void> {
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

const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useOfflineBiometricTestQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    try { setPendingCount((await idbGetAll()).length); } catch { /* IndexedDB unavailable. */ }
  }, []);

  const enqueue = useCallback(async (capture: Omit<QueuedBiometricTestCapture, "id">) => {
    const entry: QueuedBiometricTestCapture = { ...capture, id: crypto.randomUUID() };
    await idbPut(entry);
    await refreshCount();
  }, [refreshCount]);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    let pending: QueuedBiometricTestCapture[];
    try { pending = await idbGetAll(); } catch { return; }
    if (!pending.length) return;

    setSyncing(true);
    let synced = 0;
    let failed = 0;
    for (const capture of pending) {
      try {
        const { data, error } = await supabase.functions.invoke("device-attendance", {
          body: {
            device_identifier: capture.device_identifier,
            event_type: capture.event_type,
            face_photo_base64: capture.face_photo_base64,
            captured_at: capture.captured_at,
            idempotency_key: capture.idempotency_key,
            source_event_id: capture.source_event_id ?? capture.id,
            is_offline_sync: true,
            biometric_test_mode: true,
            test_session_id: capture.test_session_id ?? null,
            gps: capture.gps_lat != null && capture.gps_lng != null ? { lat: capture.gps_lat, lng: capture.gps_lng, accuracy: capture.gps_accuracy } : null,
          },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Biometric test sync failed");
        await idbDelete(capture.id);
        synced += 1;
      } catch (error) {
        console.warn("[BiometricTestQueue] Sync failed " + describeError(error));
        failed += 1;
      }
    }

    await refreshCount();
    setSyncing(false);
    if (synced > 0) toast.success("Synced " + synced + " biometric test capture" + (synced > 1 ? "s" : ""));
    if (failed > 0) toast.error(String(failed) + " biometric test capture" + (failed > 1 ? "s" : "") + " failed to sync");
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
