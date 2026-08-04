import { useCallback, useEffect, useState } from "react";
import { emptyDeviceBattery, readDeviceBattery, type DeviceBatterySnapshot } from "@/lib/deviceBattery";

export function useDeviceBattery({
  enabled = true,
  intervalMs = 60_000,
}: {
  enabled?: boolean;
  intervalMs?: number;
} = {}) {
  const [battery, setBattery] = useState<DeviceBatterySnapshot>(emptyDeviceBattery);

  const refreshBattery = useCallback(async () => {
    if (!enabled) return;
    setBattery(await readDeviceBattery());
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    void refreshBattery();
    const interval = window.setInterval(() => void refreshBattery(), intervalMs);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshBattery();
      }
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [enabled, intervalMs, refreshBattery]);

  return {
    battery,
    refreshBattery,
  };
}
