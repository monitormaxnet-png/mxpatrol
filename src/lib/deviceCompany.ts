import { getPatrolDeviceInfo } from "@/lib/deviceInfo";
import { supabase } from "@/integrations/supabase/client";

const DEVICE_COMPANY_CACHE_KEY = "mxpatrol_device_company";

export type DeviceCompany = {
  companyId: string;
  siteId: string | null;
  deviceIdentifier: string;
  deviceName: string | null;
  pairingStatus: string | null;
};

type CachedDeviceCompany = DeviceCompany & {
  cachedAt: string;
};

export const getLocalDeviceIdentifier = () => getPatrolDeviceInfo().deviceIdentifier;

const readCachedDeviceCompany = (deviceIdentifier: string): DeviceCompany | null => {
  try {
    const raw = window.localStorage.getItem(DEVICE_COMPANY_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedDeviceCompany;
    if (cached.deviceIdentifier !== deviceIdentifier || !cached.companyId) return null;

    return {
      companyId: cached.companyId,
      siteId: cached.siteId ?? null,
      deviceIdentifier: cached.deviceIdentifier,
      deviceName: cached.deviceName ?? null,
      pairingStatus: cached.pairingStatus ?? null,
    };
  } catch {
    return null;
  }
};

const cacheDeviceCompany = (device: DeviceCompany) => {
  try {
    const cached: CachedDeviceCompany = {
      ...device,
      cachedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(DEVICE_COMPANY_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Cache is best-effort only.
  }
};

export async function resolveDeviceCompany(): Promise<DeviceCompany | null> {
  const deviceIdentifier = getLocalDeviceIdentifier();

  try {
    const { data, error } = await supabase.functions.invoke("device-company", {
      body: { device_identifier: deviceIdentifier },
    });

    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "Device company lookup failed");

    const device = data.device;
    if (!device?.company_id) return null;

    const resolved: DeviceCompany = {
      companyId: device.company_id,
      siteId: device.site_id ?? null,
      deviceIdentifier: device.device_identifier ?? deviceIdentifier,
      deviceName: device.device_name ?? null,
      pairingStatus: device.pairing_status ?? null,
    };

    cacheDeviceCompany(resolved);
    return resolved;
  } catch (error) {
    const cached = readCachedDeviceCompany(deviceIdentifier);
    if (cached) return cached;
    throw error;
  }
}