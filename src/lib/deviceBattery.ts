import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";

export type DeviceBatterySnapshot = {
  level: number | null;
  charging: boolean | null;
  updatedAt: string | null;
};

export const emptyDeviceBattery: DeviceBatterySnapshot = {
  level: null,
  charging: null,
  updatedAt: null,
};

export async function readDeviceBattery(): Promise<DeviceBatterySnapshot> {
  if (!Capacitor.isNativePlatform()) {
    return emptyDeviceBattery;
  }

  try {
    const info = await Device.getBatteryInfo();
    const level = typeof info.batteryLevel === "number"
      ? Math.round(info.batteryLevel * 100)
      : null;

    return {
      level,
      charging: typeof info.isCharging === "boolean" ? info.isCharging : null,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn("[Device] Battery status unavailable", error);
    return emptyDeviceBattery;
  }
}

export const batteryMetadata = (battery: DeviceBatterySnapshot | null | undefined) => {
  if (!battery || battery.level == null) return {};

  return {
    battery_level: battery.level,
    battery_charging: battery.charging,
    battery_updated_at: battery.updatedAt,
  };
};
