import { Capacitor } from "@capacitor/core";

const DEVICE_ID_KEY = "mxpatrol_device_identifier";

const getOrCreateDeviceIdentifier = () => {
  if (typeof window === "undefined") return "server";

  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const created = `mxp-${crypto.randomUUID()}`;
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
};

export type PatrolDeviceInfo = {
  deviceId: string;
  deviceIdentifier: string;
  metadata: Record<string, unknown>;
};

export function getPatrolDeviceInfo(): PatrolDeviceInfo {
  const deviceIdentifier = getOrCreateDeviceIdentifier();

  return {
    deviceId: deviceIdentifier,
    deviceIdentifier,
    metadata: {
      platform: Capacitor.getPlatform(),
      native: Capacitor.isNativePlatform(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      language: typeof navigator !== "undefined" ? navigator.language : null,
      screen:
        typeof window !== "undefined"
          ? {
              width: window.screen.width,
              height: window.screen.height,
              pixelRatio: window.devicePixelRatio,
            }
          : null,
      capturedAt: new Date().toISOString(),
    },
  };
}
