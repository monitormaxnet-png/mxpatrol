import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useDeviceCommands(deviceId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["device-commands", deviceId],
    queryFn: async () => {
      let query = supabase
        .from("device_commands")
        .select("*, devices(device_name, device_identifier)")
        .order("issued_at", { ascending: false })
        .limit(100);

      if (deviceId) {
        query = query.eq("device_id", deviceId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: 10000,
  });
}

export function useDeviceHeartbeats(deviceId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["device-heartbeats", deviceId],
    queryFn: async () => {
      let query = supabase
        .from("device_heartbeats")
        .select("*, devices(device_name)")
        .order("created_at", { ascending: false })
        .limit(50);

      if (deviceId) {
        query = query.eq("device_id", deviceId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useFleetStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["fleet-stats"],
    queryFn: async () => {
      const { data: devices, error } = await supabase
        .from("devices")
        .select("id, status, battery_level, compliance_score, app_type, last_seen_at");
      if (error) throw error;

      const total = devices?.length || 0;
      const online = devices?.filter((d) => d.status === "online").length || 0;
      const offline = devices?.filter((d) => d.status === "offline").length || 0;
      const lowBattery = devices?.filter((d) => (d.battery_level ?? 100) <= 20).length || 0;
      const avgCompliance = total > 0
        ? Math.round(devices!.reduce((sum, d) => sum + (Number(d.compliance_score) || 100), 0) / total)
        : 100;
      const guardDevices = devices?.filter((d) => d.app_type === "guard_device").length || 0;
      const adminDevices = devices?.filter((d) => d.app_type === "admin_app").length || 0;

      // Stale = not seen in 30 minutes
      const staleThreshold = Date.now() - 30 * 60 * 1000;
      const stale = devices?.filter((d) => {
        if (!d.last_seen_at) return true;
        return new Date(d.last_seen_at).getTime() < staleThreshold;
      }).length || 0;

      return { total, online, offline, lowBattery, avgCompliance, guardDevices, adminDevices, stale };
    },
    enabled: !!user,
    refetchInterval: 15000,
  });
}
