import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export interface GuardPosition {
  guard_id: string;
  full_name: string;
  badge_number: string;
  lat: number;
  lng: number;
  scanned_at: string;
}

async function fetchGuardPositions(): Promise<GuardPosition[]> {
  const { data, error } = await supabase
    .from("scan_logs")
    .select("guard_id, gps_lat, gps_lng, scanned_at, guards(full_name, badge_number)")
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .order("scanned_at", { ascending: false })
    .limit(100);

  if (error) throw error;

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
}

export function useGuardPositions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Realtime subscription: invalidate on new scan_logs with GPS
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("guard-positions-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scan_logs" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.gps_lat != null && row.gps_lng != null) {
            // Immediately invalidate to refetch positions
            queryClient.invalidateQueries({ queryKey: ["guard_positions"] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return useQuery({
    queryKey: ["guard_positions"],
    queryFn: fetchGuardPositions,
    enabled: !!user,
    refetchInterval: 30_000,
  });
}
