/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BatteryWarning, Clock, Radio, ShieldAlert, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAlerts } from "@/hooks/useDashboardData";
import { useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { format, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, LiveStatusBadge, LoadingState } from "@/components/feedback/FeedbackPrimitives";

const iconMap: Record<string, typeof AlertTriangle> = {
  missed_checkpoint: Clock,
  late_patrol: Clock,
  panic_button: ShieldAlert,
  device_offline: Radio,
  anomaly: AlertTriangle,
};

const colorMap: Record<string, string> = {
  missed_checkpoint: "text-warning",
  late_patrol: "text-warning",
  panic_button: "text-destructive",
  device_offline: "text-muted-foreground",
  anomaly: "text-warning",
};

const extractMessageField = (message: string | null | undefined, label: string) => {
  if (!message) return null;
  const parts = message.split("|").map((part) => part.trim());
  const prefix = `${label}:`;
  const match = parts.find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()));
  return match ? match.slice(prefix.length).trim() : null;
};

const isLowBatteryAlert = (alert: any) =>
  alert.type === "anomaly" && typeof alert.message === "string" && alert.message.includes("Low Battery Alert");

const liveAlertMessage = (alert: any) => {
  if (isLowBatteryAlert(alert)) {
    const device = extractMessageField(alert.message, "Device") || "Patrol device";
    const battery = extractMessageField(alert.message, "Battery") || "Low battery";
    const site = extractMessageField(alert.message, "Site") || extractMessageField(alert.message, "Site ID") || "Unassigned site";
    const time = extractMessageField(alert.message, "Time") || format(new Date(alert.created_at), "HH:mm:ss");
    return `Device Low Battery | ${device} | ${battery} | Site: ${site} | Time: ${time}`;
  }

  if (alert.type !== "panic_button") return alert.message;

  const createdAt = new Date(alert.created_at);
  const companyName = alert.companies?.name || extractMessageField(alert.message, "Company") || "Unknown company";
  const siteName = extractMessageField(alert.message, "Site") || "Unassigned site";
  const date = format(createdAt, "yyyy-MM-dd");
  const time = format(createdAt, "HH:mm:ss");

  return `Company: ${companyName} | Site: ${siteName} | Date: ${date} | Time: ${time}`;
};

const AlertsFeed = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: alerts = [], isLoading } = useAlerts();
  const realtime = useRealtimeConnectionStatus("live-alerts");
  const latestAlertId = alerts[0]?.id;
  const latestAlertTime = alerts[0]?.created_at;

  useEffect(() => {
    if (latestAlertId) realtime.markUpdated();
    // realtime.markUpdated updates this hook state and is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAlertId]);

  const lastUpdatedLabel = useMemo(() => {
    const value = latestAlertTime || realtime.lastUpdatedAt;
    return value ? format(new Date(value), "HH:mm:ss") : "Waiting";
  }, [latestAlertTime, realtime.lastUpdatedAt]);

  const resolveAlert = async (alert: any) => {
    const { error } = await supabase.from("alerts").update({ is_read: true }).eq("id", alert.id);
    if (!error) {
      window.dispatchEvent(new CustomEvent("mxpatrol:sos-resolved", { detail: { id: alert.id } }));
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    }
  };

  const openIncidentReport = (alert: any) => {
    sessionStorage.setItem(
      "mxpatrol_sos_alert_context",
      JSON.stringify({
        alertId: alert.id,
        message: alert.message,
        createdAt: alert.created_at,
      })
    );
    navigate(`/incidents?sosAlert=${encodeURIComponent(alert.id)}`);
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <div>
          <h3 className="font-heading text-sm font-semibold text-foreground">Live Alerts</h3>
          <p className="text-[10px] text-muted-foreground">Last updated: {lastUpdatedLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <LiveStatusBadge status={realtime.status} lastUpdatedAt={realtime.lastUpdatedAt} compact />
          <span className="flex h-5 items-center rounded-full bg-destructive/20 px-2 text-[10px] font-bold text-destructive">
            {alerts.filter((a) => !a.is_read).length} Active
          </span>
        </div>
      </div>
      <div className="flex-1 divide-y divide-border/30 overflow-auto">
        {isLoading && (
          <div className="p-4"><LoadingState label="Loading live alerts..." /></div>
        )}
        {!isLoading && alerts.length === 0 && (
          <div className="p-4"><EmptyState title="No active alerts" description="The command center is live and waiting for new events." /></div>
        )}
        {alerts.map((alert, i) => {
          const lowBattery = isLowBatteryAlert(alert);
          const Icon = lowBattery ? BatteryWarning : iconMap[alert.type] || AlertTriangle;
          const color = lowBattery ? "text-warning" : colorMap[alert.type] || "text-muted-foreground";
          const isSos = alert.type === "panic_button";
          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/30 ${isSos && !alert.is_read ? "bg-destructive/5 ring-1 ring-destructive/20 sos-alert-row" : ""} ${lowBattery && !alert.is_read ? "bg-warning/5 ring-1 ring-warning/20" : ""}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{liveAlertMessage(alert)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                  </p>
                  {isSos && (
                    <>
                      <button
                        type="button"
                        onClick={() => openIncidentReport(alert)}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-destructive/30 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <FileText className="h-3 w-3" /> Open Incident
                      </button>
                      {!alert.is_read && (
                        <button
                          type="button"
                          onClick={() => resolveAlert(alert)}
                          className="inline-flex h-6 items-center rounded-md border border-warning/30 px-2 text-[10px] font-medium text-warning transition-colors hover:bg-warning/10"
                        >
                          Resolve
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default AlertsFeed;
