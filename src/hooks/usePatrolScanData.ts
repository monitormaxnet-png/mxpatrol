import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeNfcUid } from "@/lib/nfcUid";

export type PatrolScanRow = {
  id: string;
  company_id: string;
  checkpoint_id: string | null;
  guard_id: string | null;
  device_id: string | null;
  device_identifier: string | null;
  scanned_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  tag_uid: string | null;
  tag_status: string;
  is_offline_sync: boolean | null;
  site_id: string | null;
  sites?: { name: string } | null;
  checkpoints: { name: string; nfc_tag_id: string; site_id?: string | null; sites?: { name: string } | null } | null;
  guards: { full_name: string; badge_number: string } | null;
};

export type PendingUnregisteredCheckpointRow = {
  id: string;
  company_id: string;
  device_id: string | null;
  device_identifier: string | null;
  tag_uid: string;
  scanned_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  tag_status: string;
  checkpoint_id: string | null;
  site_id: string | null;
  sites?: { name: string } | null;
};

export function useCompanyId() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["current_company", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data.company_id;
    },
    enabled: !!user,
  });
}

export function usePatrolScans(limit = 50, siteId = "all") {
  const queryClient = useQueryClient();
  const { data: companyId, isLoading: companyLoading, error: companyError } = useCompanyId();

  const scansQuery = useQuery({
    queryKey: ["live_patrol_scans", companyId, siteId, limit],
    queryFn: async () => {
      let query = supabase
        .from("scan_logs")
        .select("id, company_id, site_id, checkpoint_id, patrol_session_id, patrol_validation_status, guard_id, device_id, device_identifier, scanned_at, gps_lat, gps_lng, gps_accuracy, tag_uid, tag_status, is_offline_sync, sites(name), checkpoints(name, nfc_tag_id, site_id, sites(name)), guards(full_name, badge_number)")
        .eq("company_id", companyId!)
        .order("scanned_at", { ascending: false })
        .limit(limit);
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatrolScanRow[];
    },
    enabled: !!companyId,
  });

  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`live-patrol-scans-${companyId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scan_logs",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          console.info("[Realtime] scan_logs event received", payload.new);
          queryClient.invalidateQueries({ queryKey: ["live_patrol_scans", companyId] });
          queryClient.invalidateQueries({ queryKey: ["session_scan_logs", companyId] });
          queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
          queryClient.invalidateQueries({ queryKey: ["patrol_scans_today"] });
          queryClient.invalidateQueries({ queryKey: ["device_trails"] });
          queryClient.invalidateQueries({ queryKey: ["scan_map_events"] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scan_logs",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          console.info("[Realtime] scan_logs event received", payload.new);
          queryClient.invalidateQueries({ queryKey: ["live_patrol_scans", companyId] });
          queryClient.invalidateQueries({ queryKey: ["session_scan_logs", companyId] });
          queryClient.invalidateQueries({ queryKey: ["pending_unregistered_checkpoints", companyId] });
          queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
          queryClient.invalidateQueries({ queryKey: ["patrol_scans_today"] });
          queryClient.invalidateQueries({ queryKey: ["device_trails"] });
          queryClient.invalidateQueries({ queryKey: ["scan_map_events"] });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.warn("[LivePatrol] Realtime scan channel failed");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  return {
    ...scansQuery,
    isLoading: companyLoading || scansQuery.isLoading,
    error: companyError ?? scansQuery.error,
  };
}

export function useLivePatrolScans(limit = 20, siteId = "all") {
  const scans = usePatrolScans(limit, siteId);

  return {
    ...scans,
    data: scans.data?.filter((scan) => scan.checkpoint_id && scan.tag_status !== "unregistered" && scan.tag_status !== "rejected") ?? [],
  };
}

export function useSessionScanLogs(limit = 100, siteId = "all") {
  const queryClient = useQueryClient();
  const { data: companyId, isLoading: companyLoading, error: companyError } = useCompanyId();

  const logsQuery = useQuery({
    queryKey: ["session_scan_logs", companyId, siteId, limit],
    queryFn: async () => {
      let query = supabase
        .from("scan_logs")
        .select("id, company_id, site_id, checkpoint_id, patrol_session_id, patrol_validation_status, guard_id, device_id, device_identifier, scanned_at, gps_lat, gps_lng, gps_accuracy, tag_uid, tag_status, is_offline_sync, sites(name), checkpoints(name, nfc_tag_id, site_id, sites(name)), guards(full_name, badge_number)")
        .eq("company_id", companyId!)
        .order("scanned_at", { ascending: false })
        .limit(limit);
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatrolScanRow[];
    },
    enabled: !!companyId,
  });

  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`session-scan-logs-${companyId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scan_logs",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          console.info("[Realtime] scan_logs event received", payload.new);
          queryClient.invalidateQueries({ queryKey: ["session_scan_logs", companyId] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scan_logs",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          console.info("[Realtime] scan_logs event received", payload.new);
          queryClient.invalidateQueries({ queryKey: ["session_scan_logs", companyId] });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.warn("[SessionLogs] Realtime scan channel failed");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  return {
    ...logsQuery,
    isLoading: companyLoading || logsQuery.isLoading,
    error: companyError ?? logsQuery.error,
  };
}

export function usePendingUnregisteredCheckpoints(limit = 20, siteId = "all") {
  const queryClient = useQueryClient();
  const { data: companyId, isLoading: companyLoading, error: companyError } = useCompanyId();

  const pendingQuery = useQuery({
    queryKey: ["pending_unregistered_checkpoints", companyId, siteId, limit],
    queryFn: async () => {
      let query = supabase
        .from("scan_logs")
        .select("id, company_id, site_id, device_id, device_identifier, tag_uid, scanned_at, gps_lat, gps_lng, gps_accuracy, tag_status, checkpoint_id, sites(name)")
        .eq("company_id", companyId!)
        .eq("tag_status", "unregistered")
        .is("checkpoint_id", null)
        .order("scanned_at", { ascending: false })
        .limit(Math.max(limit * 5, 50));
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;

      const latestByTag = new Map<string, PendingUnregisteredCheckpointRow>();
      for (const row of (data ?? []) as PendingUnregisteredCheckpointRow[]) {
        const key = normalizeNfcUid(row.tag_uid);
        if (!key || latestByTag.has(key)) continue;
        latestByTag.set(key, row);
      }

      return Array.from(latestByTag.values()).slice(0, limit);
    },
    enabled: !!companyId,
  });

  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`pending-unregistered-checkpoints-${companyId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scan_logs",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["pending_unregistered_checkpoints", companyId] });
          queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags_count"] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scan_logs",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["pending_unregistered_checkpoints", companyId] });
          queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags_count"] });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.warn("[PendingUnregistered] Realtime pending tag channel failed");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  return {
    ...pendingQuery,
    isLoading: companyLoading || pendingQuery.isLoading,
    error: companyError ?? pendingQuery.error,
  };
}

export function patrolScanDeviceIdentity(scan: PatrolScanRow) {
  return scan.device_identifier || scan.device_id || "Unknown device";
}

export function patrolScanCheckpointName(scan: PatrolScanRow) {
  return scan.checkpoints?.name || (scan.tag_uid ? `Unregistered tag ${scan.tag_uid}` : "Unknown checkpoint");
}

export function pendingCheckpointDeviceIdentity(checkpoint: PendingUnregisteredCheckpointRow) {
  return checkpoint.device_identifier || checkpoint.device_id || "Unknown device";
}



