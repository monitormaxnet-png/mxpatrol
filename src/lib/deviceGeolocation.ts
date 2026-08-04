import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type DeviceLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: "native" | "web";
};

const highAccuracyLocationOptions = {
  enableHighAccuracy: true,
  timeout: 30000,
  maximumAge: 30000,
};

const fallbackLocationOptions = {
  enableHighAccuracy: false,
  timeout: 20000,
  maximumAge: 120000,
};

const GEOLOCATION_TIMEOUT_CODE = "OS-PLUG-GLOC-0010";

const isLocationTimeoutError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === GEOLOCATION_TIMEOUT_CODE;
};

const hasLocationPermission = (permission: string | undefined) =>
  permission === "granted" || permission === "limited";

let permissionGranted = false;
let lastLocation: DeviceLocation | null = null;
let lastLocationAt = 0;
let inFlightLocation: Promise<DeviceLocation> | null = null;

export async function ensureLocationPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (permissionGranted) {
    return;
  }

  const currentPermission = await Geolocation.checkPermissions();

  if (
    hasLocationPermission(currentPermission.location) ||
    hasLocationPermission(currentPermission.coarseLocation)
  ) {
    permissionGranted = true;
    return;
  }

  const requestedPermission = await Geolocation.requestPermissions();

  if (
    !hasLocationPermission(requestedPermission.location) &&
    !hasLocationPermission(requestedPermission.coarseLocation)
  ) {
    throw new Error("Location permission denied");
  }

  permissionGranted = true;
}

export function getCachedDeviceLocation(maxAgeMs = 30000): DeviceLocation | null {
  if (!lastLocation || Date.now() - lastLocationAt > maxAgeMs) {
    return null;
  }

  return lastLocation;
}

const toDeviceLocation = (position: Awaited<ReturnType<typeof Geolocation.getCurrentPosition>>): DeviceLocation => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
  accuracy: position.coords.accuracy ?? null,
  source: "native",
});

const rememberLocation = (location: DeviceLocation) => {
  lastLocation = location;
  lastLocationAt = Date.now();
  return location;
};

export async function getDeviceLocation({ maxAgeMs = 30000 } = {}): Promise<DeviceLocation> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Native GPS is only available in the installed app");
  }

  const cached = getCachedDeviceLocation(maxAgeMs);
  if (cached) {
    return cached;
  }

  if (inFlightLocation) {
    return inFlightLocation;
  }

  await ensureLocationPermission();

  inFlightLocation = Geolocation.getCurrentPosition(highAccuracyLocationOptions)
    .catch((highAccuracyError) => {
      if (!isLocationTimeoutError(highAccuracyError)) {
        throw highAccuracyError;
      }

      console.warn("[Geolocation] High-accuracy GPS timed out; retrying with fallback provider", highAccuracyError);
      return Geolocation.getCurrentPosition(fallbackLocationOptions);
    })
    .then(toDeviceLocation)
    .then(rememberLocation)
    .finally(() => {
      inFlightLocation = null;
    });

  return inFlightLocation;
}
