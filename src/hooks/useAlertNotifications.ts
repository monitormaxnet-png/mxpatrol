import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const severityStyles: Record<string, { title: string }> = {
  critical: { title: "🚨 CRITICAL ALERT" },
  high: { title: "⚠️ High Alert" },
  medium: { title: "Alert" },
  low: { title: "Notice" },
};

export function useAlertNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    const channel = supabase
      .channel("all-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          const alert = payload.new as { message: string; severity: string; type: string };
          const style = severityStyles[alert.severity] || severityStyles.low;
          const isFaceAlert = alert.message?.toLowerCase().includes("face verification");
          
          if (isFaceAlert) {
            toast.error(alert.message, {
              description: "🔐 FACE ID SECURITY ALERT",
              duration: 12000,
            });
          } else {
            toast.error(alert.message, {
              description: style.title,
              duration: alert.severity === "critical" ? 10000 : 5000,
            });
          }
          // Refresh notification center
          queryClient.invalidateQueries({ queryKey: ["alerts"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incidents" },
        (payload) => {
          const incident = payload.new as { title: string; severity: string };
          toast.warning(`New Incident: ${incident.title}`, {
            description: `Severity: ${incident.severity}`,
            duration: 6000,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scan_logs" },
        () => {
          toast.info("New NFC scan recorded", { duration: 3000 });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "camera_events" },
        (payload) => {
          const evt = payload.new as { event_type: string; severity: string; description: string };
          const critical = ["intrusion", "motion_restricted", "suspicious_behavior"];
          if (critical.includes(evt.event_type)) {
            toast.error(`📹 Camera: ${evt.event_type.replace(/_/g, " ").toUpperCase()}`, {
              description: evt.description || "Check camera feed immediately",
              duration: 12000,
            });
          }
          queryClient.invalidateQueries({ queryKey: ["camera_events"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      initializedRef.current = false;
    };
  }, [user]);
}
