import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type RealtimeState = "connecting" | "live" | "reconnecting";

export function useRealtimeConnectionStatus(channelName: string) {
  const [status, setStatus] = useState<RealtimeState>("connecting");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    setStatus("connecting");

    const channel = supabase.channel(`status-${channelName}-${crypto.randomUUID()}`).subscribe((nextStatus) => {
      if (nextStatus === "SUBSCRIBED") {
        setStatus("live");
        setLastUpdatedAt(new Date().toISOString());
      }
      if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT" || nextStatus === "CLOSED") {
        setStatus("reconnecting");
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName]);

  const markUpdated = useCallback(() => setLastUpdatedAt(new Date().toISOString()), []);

  return { status, lastUpdatedAt, markUpdated };
}

export function realtimeStatusLabel(status: RealtimeState) {
  return status === "live" ? "Live" : status === "connecting" ? "Connecting..." : "Reconnecting...";
}
