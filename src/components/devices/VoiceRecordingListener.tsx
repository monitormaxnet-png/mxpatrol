import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceLocation } from "@/lib/deviceGeolocation";
import { getPatrolDeviceInfo } from "@/lib/deviceInfo";
import { useOfflineIncidentPhotoQueue } from "@/hooks/useOfflineIncidentPhotoQueue";

type VoiceRecordingDetail = {
  schema?: string;
  status: "started" | "stopped" | "error";
  capturedAtMs: number;
  durationMs?: number;
  audioBase64?: string;
  contentType?: string;
  filename?: string;
  reason?: string;
};

function parseVoiceRecordingEvent(event: Event): VoiceRecordingDetail | null {
  const raw = (event as CustomEvent<VoiceRecordingDetail>).detail;
  if (!raw || typeof raw !== "object" || !raw.status) return null;
  return raw;
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

export default function VoiceRecordingListener() {
  const { enqueue } = useOfflineIncidentPhotoQueue();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    const handleVoiceRecording = async (event: Event) => {
      const detail = parseVoiceRecordingEvent(event);
      if (!detail) return;

      const deviceInfo = getPatrolDeviceInfo();
      const capturedAt = new Date(detail.capturedAtMs).toISOString();
      const durationMs = Math.min(Math.max(0, detail.durationMs ?? 0), 60_000);

      if (detail.status === "started") {
        window.dispatchEvent(new CustomEvent("mxpatrol:voice-feedback", {
          detail: {
            id: `recording-${detail.capturedAtMs}`,
            status: "recording",
            deviceIdentifier: deviceInfo.deviceIdentifier,
            capturedAt,
            durationMs: 0,
            message: "Recording...",
          },
        }));
        return;
      }

      if (detail.status === "error") {
        const reason = detail.reason || "unknown";
        if (reason === "too_short") {
          window.dispatchEvent(new CustomEvent("mxpatrol:voice-feedback", { detail: { id: `voice-short-${Date.now()}`, status: "cancelled", deviceIdentifier: deviceInfo.deviceIdentifier, capturedAt, message: "Hold Volume Down to record" } }));
          toast.info("Hold Volume Down to record a voice message");
          return;
        }
        console.warn("[VoiceRecording] recording error " + reason);
        window.dispatchEvent(new CustomEvent("mxpatrol:voice-feedback", {
          detail: {
            id: `voice-error-${Date.now()}`,
            status: "error",
            deviceIdentifier: deviceInfo.deviceIdentifier,
            capturedAt,
            message: reason.replace(/_/g, " "),
          },
        }));
        if (reason === "microphone_permission_requested") toast.info("Allow microphone permission to send voice recordings");
        else toast.error("Voice recording failed: " + reason.replace(/_/g, " "));
        return;
      }

      if (!detail.audioBase64) {
        window.dispatchEvent(new CustomEvent("mxpatrol:voice-feedback", {
          detail: {
            id: `voice-empty-${Date.now()}`,
            status: "error",
            deviceIdentifier: deviceInfo.deviceIdentifier,
            capturedAt,
            message: "No audio data",
          },
        }));
        toast.error("Voice recording failed: no audio data");
        return;
      }

      window.dispatchEvent(new CustomEvent("mxpatrol:voice-feedback", {
        detail: {
          id: `voice-uploading-${detail.capturedAtMs}`,
          status: "uploading",
          deviceIdentifier: deviceInfo.deviceIdentifier,
          capturedAt,
          durationMs,
          message: "Uploading voice recording...",
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
        media_type: "audio" as const,
        audio_base64: detail.audioBase64,
        content_type: detail.contentType || "audio/mp4",
        filename: detail.filename || `rg360-voice-${detail.capturedAtMs}.m4a`,
        duration_ms: durationMs,
        gps,
        captured_at: capturedAt,
      };

      try {
        const { data, error } = await supabase.functions.invoke("device-incident-photo", { body: uploadPayload });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Voice recording upload failed");

        window.dispatchEvent(new CustomEvent("mxpatrol:voice-feedback", {
          detail: {
            id: data.photo?.id ?? `voice-${detail.capturedAtMs}`,
            status: "received",
            deviceIdentifier: deviceInfo.deviceIdentifier,
            capturedAt,
            durationMs,
            message: "VOICE SENT",
          },
        }));
        toast.success("Voice recording sent");
      } catch (error) {
        console.warn("[VoiceRecording] Direct upload failed, queueing offline", error);
        await enqueue({
          device_identifier: deviceInfo.deviceIdentifier,
          media_type: "audio",
          audio_base64: detail.audioBase64,
          content_type: detail.contentType || "audio/mp4",
          filename: detail.filename || `rg360-voice-${detail.capturedAtMs}.m4a`,
          duration_ms: durationMs,
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          gps_accuracy: gps?.accuracy ?? null,
          captured_at: capturedAt,
        });
        window.dispatchEvent(new CustomEvent("mxpatrol:voice-feedback", {
          detail: {
            id: `queued-voice-${detail.capturedAtMs}`,
            status: "queued",
            deviceIdentifier: deviceInfo.deviceIdentifier,
            capturedAt,
            durationMs,
            message: "VOICE PENDING SYNC",
          },
        }));
        toast.info("Voice recording saved offline, will sync later");
      }
    };

    window.addEventListener("mxpatrolVoiceRecording", handleVoiceRecording);
    return () => window.removeEventListener("mxpatrolVoiceRecording", handleVoiceRecording);
  }, [enqueue]);

  return null;
}