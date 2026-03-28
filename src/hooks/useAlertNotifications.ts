import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, Clock, Radio } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const alertIcons: Record<string, typeof AlertTriangle> = {
  missed_checkpoint: Clock,
  late_patrol: Clock,
  panic_button: ShieldAlert,
  device_offline: Radio,
  anomaly: AlertTriangle,
};

const severityStyles: Record<string, { bg: string; title: string }> = {
  critical: { bg: "destructive", title: "🚨 CRITICAL ALERT" },
  high: { bg: "destructive", title: "⚠️ High Alert" },
  medium: { bg: "warning", title: "Alert" },
  low: { bg: "default", title: "Notice" },
};

export function useAlertNotifications() {
  const { user } = useAuth();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    const channel = supabase
      .channel("alert-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          const alert = payload.new as {
            type: string;
            message: string;
            severity: string;
          };

          const style = severityStyles[alert.severity] || severityStyles.low;

          toast.error(alert.message, {
            description: style.title,
            duration: alert.severity === "critical" ? 10000 : 5000,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      initializedRef.current = false;
    };
  }, [user]);
}
