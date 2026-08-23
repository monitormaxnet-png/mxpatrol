import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { StructuredScanResult } from "@/lib/scanResult";
import { signSecureDevicePayload, type SecureDeviceAuth } from "@/lib/secureDevice";

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
  client_scan_id?: string | null;
  device_auth?: SecureDeviceAuth | null;
};

export type DeviceScanResult = {
  scanLogId: string | null;
  checkpoint: { id: string; name: string | null; site_id: string | null } | null;
  pendingTag: { id: string; status: string } | null;
  tagStatus: "registered" | "unregistered" | "pending_registration" | "rejected" | string;
  patrolMatch?: Record<string, unknown> | null;
  structured?: StructuredScanResult | null;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const firstObject = (value: unknown): Record<string, unknown> | null => {
  if (Array.isArray(value)) return asObject(value[0]);
  return asObject(value);
};

const normalizeCheckpoint = (value: unknown): DeviceScanResult["checkpoint"] => {
  const checkpoint = firstObject(value);
  if (!checkpoint?.id) return null;
  return {
    id: String(checkpoint.id),
    name: typeof checkpoint.name === "string" ? checkpoint.name : null,
    site_id: typeof checkpoint.site_id === "string" ? checkpoint.site_id : null,
  };
};

export async function saveDeviceScan(scan: DeviceScanPayload): Promise<DeviceScanResult> {
  const deviceAuth = scan.device_auth ?? await signSecureDevicePayload("nfc_scan", scan.device_identifier, scan);
  const requestBody = deviceAuth ? { ...scan, device_auth: deviceAuth } : scan;
  const { data, error } = await supabase.functions.invoke("device-scan", {
    body: requestBody,
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

  const body = asObject(data) ?? {};
  const scanLog = firstObject(body.scan_log) ?? firstObject(body.scanLog);
  const checkpoint = normalizeCheckpoint(body.checkpoint ?? scanLog?.checkpoints);
  const scanLogCheckpointId = typeof scanLog?.checkpoint_id === "string" ? scanLog.checkpoint_id : null;
  const scanLogStatus = typeof scanLog?.tag_status === "string" ? scanLog.tag_status : null;
  const responseStatus = typeof body.tag_status === "string" ? body.tag_status : null;
  const derivedStatus = checkpoint || scanLogCheckpointId ? "registered" : responseStatus ?? scanLogStatus ?? scan.tag_status ?? "unregistered";

  return {
    scanLogId: typeof scanLog?.id === "string" ? scanLog.id : null,
    checkpoint: checkpoint ?? (scanLogCheckpointId ? { id: scanLogCheckpointId, name: null, site_id: null } : null),
    pendingTag: firstObject(body.pending_tag) as DeviceScanResult["pendingTag"],
    tagStatus: derivedStatus,
    patrolMatch: firstObject(body.patrol_match) ?? null,
    structured: (firstObject(body.result) as unknown as StructuredScanResult | null) ?? null,
  };
}