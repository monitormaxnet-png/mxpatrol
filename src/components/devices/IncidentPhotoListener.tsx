import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceLocation } from "@/lib/deviceGeolocation";
import { getPatrolDeviceInfo } from "@/lib/deviceInfo";
import { useOfflineIncidentPhotoQueue } from "@/hooks/useOfflineIncidentPhotoQueue";

type IncidentPhotoDetail = {
  schema?: string;
  status: "captured" | "error";
  capturedAtMs: number;
  photoBase64?: string;
  reason?: string;
};

function parseIncidentPhotoEvent(event: Event): IncidentPhotoDetail | null {
  const raw = (event as CustomEvent<IncidentPhotoDetail>).detail;
  if (!raw || typeof raw !== "object" || !raw.status) return null;
  return raw;
}

export default function IncidentPhotoListener() {
  const { enqueue } = useOfflineIncidentPhotoQueue();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    const handleIncidentPhoto = async (event: Event) => {
      const detail = parseIncidentPhotoEvent(event);
      if (!detail) return;

      if (detail.status === "error") {
        const reason = detail.reason || "unknown";
        console.warn("[IncidentPhoto] capture error " + reason);
        window.dispatchEvent(new CustomEvent("mxpatrol:photo-feedback", {
          detail: { status: "error", message: reason.replace(/_/g, " ") },
        }));
        if (reason === "camera_permission_requested") {
          toast.info("Allow camera permission to save incident photos");
        } else {
          toast.error("Incident photo failed: " + reason.replace(/_/g, " "));
        }
        return;
      }

      if (!detail.photoBase64) {
        console.warn("[IncidentPhoto] captured event had no photo data");
        window.dispatchEvent(new CustomEvent("mxpatrol:photo-feedback", {
          detail: { status: "error", message: "No photo data" },
        }));
        toast.error("Incident photo failed: no photo data");
        return;
      }

      console.info("[IncidentPhoto] captured, resolving location and company", { bytesBase64: detail.photoBase64.length });
      toast.info("Incident photo captured, saving...");
      const deviceInfo = getPatrolDeviceInfo();
      const capturedAt = new Date(detail.capturedAtMs).toISOString();
      window.dispatchEvent(new CustomEvent("mxpatrol:photo-feedback", {
        detail: {
          id: `local-photo-${detail.capturedAtMs}`,
          status: "uploading",
          deviceIdentifier: deviceInfo.deviceIdentifier,
          capturedAt,
          message: "Uploading photo...",
        },
      }));

      let gps: { lat: number; lng: number; accuracy?: number | null } | null = null;
      try {
        const location = await withTimeout(getDeviceLocation({ maxAgeMs: 30000 }), 3_000);
        gps = { lat: location.lat, lng: location.lng, accuracy: location.accuracy };
      } catch {
        gps = null;
      }

      const uploadPayload = {
        device_identifier: deviceInfo.deviceIdentifier,
        photo_base64: detail.photoBase64,
        gps,
        captured_at: capturedAt,
      };

      try {
        const { data, error } = await supabase.functions.invoke("device-incident-photo", { body: uploadPayload });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Incident photo upload failed");

        console.info("[IncidentPhoto] uploaded", {
          photoId: data.photo?.id ?? null,
          storagePath: data.photo?.storage_path ?? null,
        });
        window.dispatchEvent(new CustomEvent("mxpatrol:photo-feedback", {
          detail: {
            id: data.photo?.id ?? `photo-${detail.capturedAtMs}`,
            status: "received",
            deviceIdentifier: deviceInfo.deviceIdentifier,
            capturedAt,
            message: "PHOTO SENT",
          },
        }));
        toast.success("Incident photo saved");
      } catch (error) {
        console.warn("[IncidentPhoto] Direct upload failed, queueing offline", error);
        await enqueue({
          device_identifier: deviceInfo.deviceIdentifier,
          photo_base64: detail.photoBase64,
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          gps_accuracy: gps?.accuracy ?? null,
          captured_at: capturedAt,
        });
        window.dispatchEvent(new CustomEvent("mxpatrol:photo-feedback", {
          detail: {
            id: `queued-photo-${detail.capturedAtMs}`,
            status: "queued",
            deviceIdentifier: deviceInfo.deviceIdentifier,
            capturedAt,
            message: "PHOTO PENDING SYNC",
          },
        }));
        toast.info("Incident photo saved offline, will sync later");
      }
    };

    window.addEventListener("mxpatrolIncidentPhoto", handleIncidentPhoto);
    return () => window.removeEventListener("mxpatrolIncidentPhoto", handleIncidentPhoto);
  }, [enqueue]);

  return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("GPS timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
