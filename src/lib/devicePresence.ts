import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getPatrolDeviceInfo, type PatrolDeviceInfo } from "@/lib/deviceInfo";
import { batteryMetadata, type DeviceBatterySnapshot } from "@/lib/deviceBattery";

type DeviceGps = {
  lat: number;
  lng: number;
  accuracy?: number | null;
} | null;

export const isPatrolDeviceSession = () => Capacitor.isNativePlatform();

export async function updatePatrolDevicePresence({
  companyId,
  userId,
  gps,
  device,
  seenAt,
  battery,
}: {
  companyId: string;
  userId: string | null;
  gps: DeviceGps;
  device?: PatrolDeviceInfo;
  seenAt?: string;
  battery?: DeviceBatterySnapshot | null;
}) {
  if (!isPatrolDeviceSession()) return;

  const patrolDevice = device ?? getPatrolDeviceInfo();
  const now = seenAt ?? new Date().toISOString();
  const gpsFields = gps
    ? {
        current_gps_lat: gps.lat,
        current_gps_lng: gps.lng,
        current_gps_accuracy: gps.accuracy ?? null,
        current_gps_at: now,
      }
    : {};

  const metadata = {
    ...(patrolDevice.metadata as Record<string, unknown>),
    ...batteryMetadata(battery),
  };

  const updatePayload: Record<string, unknown> = {
      device_name: `Patrol Device ${patrolDevice.deviceIdentifier.slice(-6)}`,
      device_type: "mobile",
      app_type: "guard_device",
      user_id: userId,
      status: "online",
      last_seen_at: now,
    ...gpsFields,
    battery_level: battery?.level ?? undefined,
    metadata: metadata as Json,
  };

  Object.keys(updatePayload).forEach((key) => updatePayload[key] === undefined && delete updatePayload[key]);

  const { error } = await supabase
    .from("devices")
    .update(updatePayload as any)
    .eq("company_id", companyId)
    .eq("device_identifier", patrolDevice.deviceIdentifier)
    .eq("pairing_status", "paired");

  if (error) {
    throw error;
  }
}
