import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getCachedDeviceLocation, getDeviceLocation } from "@/lib/deviceGeolocation";
import { isPatrolDeviceSession, updatePatrolDevicePresence } from "@/lib/devicePresence";

const HEARTBEAT_MS = 60_000;
const HEARTBEAT_GPS_CACHE_MS = 5 * 60_000;
const HEARTBEAT_GPS_BACKOFF_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000];
const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export default function DevicePresenceHeartbeat() {
  const { user } = useAuth();
  const isPatrolDevice = isPatrolDeviceSession();

  const { data: profile } = useQuery({
    queryKey: ["presence-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user && isPatrolDevice,
  });

  useEffect(() => {
    if (!isPatrolDevice || !user || !profile?.company_id) return;

    let cancelled = false;
    let beating = false;
    let gpsFailures = 0;
    let nextGpsAttemptAt = 0;

    const beat = async () => {
      if (beating) return;
      beating = true;
      let gps: { lat: number; lng: number; accuracy?: number | null } | null = null;

      const cachedLocation = getCachedDeviceLocation(HEARTBEAT_GPS_CACHE_MS);
      if (cachedLocation) {
        gps = { lat: cachedLocation.lat, lng: cachedLocation.lng, accuracy: cachedLocation.accuracy };
      } else if (Date.now() >= nextGpsAttemptAt) {
        try {
          const location = await getDeviceLocation({ maxAgeMs: HEARTBEAT_MS });
          gps = { lat: location.lat, lng: location.lng, accuracy: location.accuracy };
          gpsFailures = 0;
          nextGpsAttemptAt = 0;
        } catch (error) {
          gps = null;
          gpsFailures += 1;
          const backoffIndex = Math.min(gpsFailures - 1, HEARTBEAT_GPS_BACKOFF_MS.length - 1);
          nextGpsAttemptAt = Date.now() + HEARTBEAT_GPS_BACKOFF_MS[backoffIndex];
          console.warn(`[DevicePresence] GPS unavailable; backing off heartbeat GPS ${describeError(error)}`);
        }
      }

      try {
        if (!cancelled) {
          await updatePatrolDevicePresence({
            companyId: profile.company_id,
            userId: user.id,
            gps,
          });
        }
      } catch (error) {
        console.warn(`[DevicePresence] Location update failed ${describeError(error)}`);
      } finally {
        beating = false;
      }
    };

    void beat();
    const interval = window.setInterval(() => void beat(), HEARTBEAT_MS);
    const handleVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    const handleOnline = () => void beat();
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [isPatrolDevice, profile?.company_id, user]);

  return null;
}
