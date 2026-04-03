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

export interface GuardTrail {
  guard_id: string;
  full_name: string;
  badge_number: string;
  points: { lat: number; lng: number; scanned_at: string; checkpoint_name: string }[];
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

async function fetchGuardTrails(): Promise<GuardTrail[]> {
  const { data, error } = await supabase
    .from("scan_logs")
    .select("guard_id, gps_lat, gps_lng, scanned_at, guards(full_name, badge_number), checkpoints(name)")
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .order("scanned_at", { ascending: true })
    .limit(500);

  if (error) throw error;

  const trailMap = new Map<string, GuardTrail>();

  for (const row of data ?? []) {
    const guard = row.guards as { full_name: string; badge_number: string } | null;
    const checkpoint = row.checkpoints as { name: string } | null;
    if (!guard || row.gps_lat == null || row.gps_lng == null) continue;

    let trail = trailMap.get(row.guard_id);
    if (!trail) {
      trail = {
        guard_id: row.guard_id,
        full_name: guard.full_name,
        badge_number: guard.badge_number,
        points: [],
      };
      trailMap.set(row.guard_id, trail);
    }
    trail.points.push({
      lat: row.gps_lat,
      lng: row.gps_lng,
      scanned_at: row.scanned_at,
      checkpoint_name: checkpoint?.name ?? "Unknown",
    });
  }

  return Array.from(trailMap.values());
}

export function useGuardPositions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

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
            queryClient.invalidateQueries({ queryKey: ["guard_positions"] });
            queryClient.invalidateQueries({ queryKey: ["guard_trails"] });
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

export function useGuardTrails() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["guard_trails"],
    queryFn: fetchGuardTrails,
    enabled: !!user,
    refetchInterval: 30_000,
  });
}
