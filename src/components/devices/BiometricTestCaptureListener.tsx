import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceLocation } from "@/lib/deviceGeolocation";
import { getPatrolDeviceInfo } from "@/lib/deviceInfo";
import { useOfflineBiometricTestQueue } from "@/hooks/useOfflineBiometricTestQueue";

const TEST_MODE_KEY = "mxpatrol_biometric_test_mode";
const TEST_EVENT_TYPE_KEY = "mxpatrol_biometric_test_event_type";
const TEST_SESSION_KEY = "mxpatrol_biometric_test_session_id";

export type BiometricTestStatus = "CAPTURING" | "ANALYZING" | "MATCH CANDIDATE" | "NO MATCH" | "REVIEW REQUIRED" | "OFFLINE QUEUED";

type IncidentPhotoDetail = {
  schema?: string;
  status: "captured" | "error";
  capturedAtMs: number;
  photoBase64?: string;
  reason?: string;
};

export function isBiometricTestModeActive() {
  return typeof window !== "undefined" && window.localStorage.getItem(TEST_MODE_KEY) === "true";
}

export function setBiometricTestMode(active: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEST_MODE_KEY, active ? "true" : "false");
  window.dispatchEvent(new CustomEvent("mxpatrol:biometric-test-mode", { detail: { active } }));
}

export function getBiometricTestEventType(): "clock_in" | "clock_out" {
  if (typeof window === "undefined") return "clock_in";
  return window.localStorage.getItem(TEST_EVENT_TYPE_KEY) === "clock_out" ? "clock_out" : "clock_in";
}

function emitStatus(status: BiometricTestStatus, message?: string) {
  const label = message ? status + ": " + message : status;
  window.dispatchEvent(new CustomEvent("mxpatrol:biometric-test-feedback", { detail: { status, message } }));
  toast.info(label);
}

function parseIncidentPhotoEvent(event: Event): IncidentPhotoDetail | null {
  const raw = (event as CustomEvent<IncidentPhotoDetail>).detail;
  if (!raw || typeof raw !== "object" || !raw.status) return null;
  return raw;
}

export default function BiometricTestCaptureListener() {
  const { enqueue } = useOfflineBiometricTestQueue();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    const handleCapture = async (event: Event) => {
      if (!isBiometricTestModeActive()) return;
      const detail = parseIncidentPhotoEvent(event);
      if (!detail) return;

      if (detail.status === "error") {
        emitStatus("REVIEW REQUIRED", detail.reason || "Capture failed");
        toast.error("Biometric test capture failed: " + (detail.reason || "unknown"));
        return;
      }
      if (!detail.photoBase64) {
        emitStatus("REVIEW REQUIRED", "No photo data");
        toast.error("Biometric test capture failed: no photo data");
        return;
      }

      emitStatus("CAPTURING");
      const deviceInfo = getPatrolDeviceInfo();
      const capturedAt = new Date(detail.capturedAtMs).toISOString();
      const sourceEventId = "bio-test-" + detail.capturedAtMs;
      const idempotencyKey = deviceInfo.deviceIdentifier + "-" + sourceEventId;
      const testSessionId = window.localStorage.getItem(TEST_SESSION_KEY) || new Date().toISOString().slice(0, 10);

      let gps: { lat: number; lng: number; accuracy?: number | null } | null = null;
      try {
        const location = await withTimeout(getDeviceLocation({ maxAgeMs: 30000 }), 3_000);
        gps = { lat: location.lat, lng: location.lng, accuracy: location.accuracy };
      } catch {
        gps = null;
      }

      const payload = {
        device_identifier: deviceInfo.deviceIdentifier,
        event_type: getBiometricTestEventType(),
        face_photo_base64: detail.photoBase64,
        captured_at: capturedAt,
        idempotency_key: idempotencyKey,
        source_event_id: sourceEventId,
        biometric_test_mode: true,
        test_session_id: testSessionId,
        gps,
      };

      emitStatus("ANALYZING");
      try {
        const { data, error } = await supabase.functions.invoke("device-attendance", { body: payload });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Biometric test failed");
        const status = String(data.verification_status ?? "review_required");
        if (status === "review_required" && data.event?.guard_id) emitStatus("MATCH CANDIDATE", "Candidate requires tester label");
        else if (status === "unmatched") emitStatus("NO MATCH");
        else emitStatus("REVIEW REQUIRED", status.replace(/_/g, " "));
        toast.info("Biometric test capture saved for review");
      } catch (error) {
        await enqueue({
          device_identifier: deviceInfo.deviceIdentifier,
          event_type: getBiometricTestEventType(),
          face_photo_base64: detail.photoBase64,
          captured_at: capturedAt,
          idempotency_key: idempotencyKey,
          source_event_id: sourceEventId,
          test_session_id: testSessionId,
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          gps_accuracy: gps?.accuracy ?? null,
        });
        emitStatus("OFFLINE QUEUED");
        toast.info("Biometric test capture queued offline");
      }
    };

    window.addEventListener("mxpatrolIncidentPhoto", handleCapture, { capture: true });
    return () => window.removeEventListener("mxpatrolIncidentPhoto", handleCapture, { capture: true } as EventListenerOptions);
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
