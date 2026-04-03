import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GuardPosition {
  guard_id: string;
  full_name: string;
  badge_number: string;
  lat: number;
  lng: number;
  scanned_at: string;
}

export function useGuardPositions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["guard_positions"],
    queryFn: async () => {
      // Get the most recent scan with GPS for each active guard
      const { data, error } = await supabase
        .from("scan_logs")
        .select("guard_id, gps_lat, gps_lng, scanned_at, guards(full_name, badge_number)")
        .not("gps_lat", "is", null)
        .not("gps_lng", "is", null)
        .order("scanned_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      // Deduplicate: keep only the latest scan per guard
      const seen = new Set<string>();
      const positions: GuardPosition[] = [];

      for (const row of data ?? []) {
        if (seen.has(row.guard_id)) continue;
        seen.add(row.guard_id);
        const guard = row.guards as { full_name: string; badge_number: string } | null;
        if (guard && row.gps_lat != null && row.gps_lng != null) {
          positions.push({
            guard_id: row.guard_id,
            full_name: guard.full_name,
            badge_number: guard.badge_number,
            lat: row.gps_lat,
            lng: row.gps_lng,
            scanned_at: row.scanned_at,
          });
        }
      }

      return positions;
    },
    enabled: !!user,
    refetchInterval: 30_000, // refresh every 30s
  });
}
