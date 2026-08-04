import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import type { Tables } from "@/integrations/supabase/types";

export function useGuards() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guards").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"guards">[];
    },
    enabled: !!user,
  });
}

export function useAlerts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*, companies(name), guards(full_name, badge_number)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useScanLogs(siteId = "all") {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["scan_logs", siteId],
    queryFn: async () => {
      let query = supabase
        .from("scan_logs")
        .select("*, sites(name), guards(full_name, badge_number), checkpoints(name)")
        .order("scanned_at", { ascending: false })
        .limit(20);
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function usePatrols() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["patrols"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patrols")
        .select("*, guards(full_name, badge_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useDevices(siteId = "all") {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["devices", siteId],
    queryFn: async () => {
      let query = supabase
        .from("devices")
        .select("*, sites(name), guards(full_name, badge_number)")
        .order("last_seen_at", { ascending: false });
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useCheckpoints(siteId = "all") {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["checkpoints", siteId],
    queryFn: async () => {
      let query = supabase.from("checkpoints").select("*, sites(name)").order("sort_order");
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return data as Tables<"checkpoints">[];
    },
    enabled: !!user,
  });
}

export function useIncidents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["incidents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incidents")
        .select("*, guards(full_name, badge_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useAIInsights() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ai_insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_insights")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as Tables<"ai_insights">[];
    },
    enabled: !!user,
  });
}

// Realtime subscriptions — invalidate queries on changes
export function useRealtimeSubscriptions() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, (payload) => {
        const alert = payload.new as { type?: string; severity?: string; id?: string };
        if (alert?.type === "panic_button") console.info("[Realtime] SOS alert received", payload.new);
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "scan_logs" }, (payload) => {
        console.info("[Realtime] scan_logs event received", payload.new);
        queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
        queryClient.invalidateQueries({ queryKey: ["live_patrol_scans"] });
        queryClient.invalidateQueries({ queryKey: ["session_scan_logs"] });
        queryClient.invalidateQueries({ queryKey: ["pending_unregistered_checkpoints"] });
        queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags_count"] });
        queryClient.invalidateQueries({ queryKey: ["patrol_scans_today"] });
        queryClient.invalidateQueries({ queryKey: ["device_trails"] });
        queryClient.invalidateQueries({ queryKey: ["scan_map_events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, () => {
        queryClient.invalidateQueries({ queryKey: ["incidents"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "patrols" }, () => {
        queryClient.invalidateQueries({ queryKey: ["patrols"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "guards" }, () => {
        queryClient.invalidateQueries({ queryKey: ["guards"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, () => {
        queryClient.invalidateQueries({ queryKey: ["devices"] });
        queryClient.invalidateQueries({ queryKey: ["device_positions"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_nfc_tags" }, () => {
        queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] });
        queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags_count"] });
        queryClient.invalidateQueries({ queryKey: ["pending_unregistered_checkpoints"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "checkpoints" }, () => {
        queryClient.invalidateQueries({ queryKey: ["checkpoints"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}


