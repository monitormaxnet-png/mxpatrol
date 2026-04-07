import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export function useDeviceRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("device-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_commands" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["device-commands"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_heartbeats" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["devices"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_activity_logs" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["device-activity-logs"] });
          queryClient.invalidateQueries({ queryKey: ["devices"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
