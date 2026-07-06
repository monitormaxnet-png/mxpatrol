import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type DeviceScanPayload = {
  id?: string;
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
  device_metadata?: Record<string, unknown> | Json;
  face_verified?: boolean | null;
  face_confidence?: number | null;
  is_offline_sync?: boolean;
};

export type DeviceScanResult = {
  scanLogId: string | null;
  checkpoint: { id: string; name: string | null; site_id: string | null } | null;
  pendingTag: { id: string; status: string } | null;
  tagStatus: "registered" | "unregistered" | "pending_registration" | "rejected" | string;
};

export async function saveDeviceScan(scan: DeviceScanPayload): Promise<DeviceScanResult> {
  const { data, error } = await supabase.functions.invoke("device-scan", {
    body: scan,
  });

  if (error) {
    const response = (error as { context?: unknown }).context;
    let responseBody: string | null = null;
    let status: number | null = null;

    if (response && typeof response === "object") {
      const maybeResponse = response as { status?: number; clone?: () => { text?: () => Promise<string> }; text?: () => Promise<string> };
      status = typeof maybeResponse.status === "number" ? maybeResponse.status : null;
      try {
        const reader = typeof maybeResponse.clone === "function" ? maybeResponse.clone() : maybeResponse;
        responseBody = typeof reader.text === "function" ? await reader.text() : null;
      } catch {
        responseBody = null;
      }
    }

    console.error("[DeviceScan] Edge Function request failed", {
      status,
      responseBody,
      message: error.message,
      name: error.name,
    });

    throw new Error(responseBody || error.message || "Device scan save failed");
  }

  if (!data?.ok) {
    console.error("[DeviceScan] Edge Function returned failure", data);
    throw new Error(data?.error || "Device scan save failed");
  }

  return {
    scanLogId: data.scan_log?.id ?? null,
    checkpoint: data.checkpoint ?? null,
    pendingTag: data.pending_tag ?? null,
    tagStatus: data.tag_status ?? scan.tag_status ?? "unregistered",
  };
}
