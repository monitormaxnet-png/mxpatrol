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
        .select("*, guards(full_name, badge_number)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useScanLogs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["scan_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_logs")
        .select("*, guards(full_name, badge_number), checkpoints(name)")
        .order("scanned_at", { ascending: false })
        .limit(20);
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

export function useDevices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices")
        .select("*, guards(full_name, badge_number)")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useCheckpoints() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["checkpoints"],
    queryFn: async () => {
      const { data, error } = await supabase.from("checkpoints").select("*").order("sort_order");
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
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "scan_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
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
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
