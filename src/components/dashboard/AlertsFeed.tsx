/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BatteryWarning, Clock, Radio, ShieldAlert, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAlerts } from "@/hooks/useDashboardData";
import { useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { resolveSosAlert } from "@/lib/resolveSosAlert";
import { setFeedbackSoundEnabled } from "@/lib/feedbackSound";
import { startSosSiren, stopSosSiren } from "@/lib/sosSirenManager";
import { EmptyState, LiveStatusBadge, LoadingState } from "@/components/feedback/FeedbackPrimitives";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";

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
  const { canManage } = useUserRole();
  const realtime = useRealtimeConnectionStatus("live-alerts");
  const latestAlertId = alerts[0]?.id;
  const latestAlertTime = alerts[0]?.created_at;
  const [acknowledgedSosIds, setAcknowledgedSosIds] = useState<Set<string>>(() => new Set());
  const [sosSoundArmed, setSosSoundArmed] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem("mxpatrol_sos_sound_armed") === "true"
  );
  const [sosSoundPrompt, setSosSoundPrompt] = useState(false);
  const seenSosIdsRef = useRef<Set<string>>(new Set());
  const initialSosLoadRef = useRef(false);

  useEffect(() => {
    if (latestAlertId) realtime.markUpdated();
    // realtime.markUpdated updates this hook state and is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAlertId]);

  const lastUpdatedLabel = useMemo(() => {
    const value = latestAlertTime || realtime.lastUpdatedAt;
    return value ? format(new Date(value), "HH:mm:ss") : "Waiting";
  }, [latestAlertTime, realtime.lastUpdatedAt]);

  const activeSosAlerts = useMemo(
    () => alerts.filter((alert: any) => alert.type === "panic_button" && !alert.is_read),
    [alerts]
  );

  const unacknowledgedSosAlerts = useMemo(
    () => activeSosAlerts.filter((alert: any) => !acknowledgedSosIds.has(alert.id)),
    [activeSosAlerts, acknowledgedSosIds]
  );

  useEffect(() => {
    const enableSound = () => {
      setFeedbackSoundEnabled(true);
      window.localStorage.setItem("mxpatrol_sos_sound_armed", "true");
      setSosSoundArmed(true);
      setSosSoundPrompt(false);
    };

    window.addEventListener("pointerdown", enableSound, { once: true });
    window.addEventListener("keydown", enableSound, { once: true });
    return () => {
      window.removeEventListener("pointerdown", enableSound);
      window.removeEventListener("keydown", enableSound);
    };
  }, []);

  useEffect(() => {
    if (!initialSosLoadRef.current) {
      seenSosIdsRef.current = new Set(activeSosAlerts.map((alert: any) => alert.id));
      initialSosLoadRef.current = true;
      return;
    }

    const newSosAlerts = activeSosAlerts.filter((alert: any) => !seenSosIdsRef.current.has(alert.id));
    if (newSosAlerts.length === 0) return;

    setAcknowledgedSosIds((current) => {
      const next = new Set(current);
      newSosAlerts.forEach((alert: any) => next.delete(alert.id));
      return next;
    });
    newSosAlerts.forEach((alert: any) => seenSosIdsRef.current.add(alert.id));

    if (!sosSoundArmed) setSosSoundPrompt(true);
    startSosSiren();
  }, [activeSosAlerts, sosSoundArmed]);

  useEffect(() => {
    if (unacknowledgedSosAlerts.length === 0) stopSosSiren();
  }, [unacknowledgedSosAlerts.length]);

  useEffect(() => () => stopSosSiren(), []);

  const enableSosSound = () => {
    setFeedbackSoundEnabled(true);
    window.localStorage.setItem("mxpatrol_sos_sound_armed", "true");
    setSosSoundArmed(true);
    setSosSoundPrompt(false);
  };

  const acknowledgeSosAlert = (alertId: string) => {
    setAcknowledgedSosIds((current) => new Set(current).add(alertId));
    stopSosSiren();
  };

  const resolveAlert = async (alert: any) => {
    if (!window.confirm("Resolve this SOS alert? This will close the active SOS case.")) return;
    try {
      await resolveSosAlert(alert.id, alert.site_id ?? null);
      acknowledgeSosAlert(alert.id);
      window.dispatchEvent(new CustomEvent("mxpatrol:sos-resolved", { detail: { id: alert.id } }));
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast({ title: "SOS alert resolved" });
    } catch (error) {
      toast({
        title: "Could not resolve SOS alert",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
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
          {sosSoundPrompt && (
            <button
              type="button"
              onClick={enableSosSound}
              className="rounded-full border border-destructive/30 px-2 py-1 text-[10px] font-semibold text-destructive transition-colors hover:bg-destructive/10"
            >
              Enable SOS Sound
            </button>
          )}
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
          const sosDevice = extractMessageField(alert.message, "Device") || extractMessageField(alert.message, "Device ID") || "Patrol device";
          const sosSite = extractMessageField(alert.message, "Site") || "Unassigned site";
          const sosStatus = alert.is_read
            ? "Resolved"
            : acknowledgedSosIds.has(alert.id)
              ? "Acknowledged - active"
              : "New active SOS";
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
                {isSos && (
                  <div className="mt-2 grid gap-1 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                    <span><strong className="text-foreground">Device:</strong> {sosDevice}</span>
                    <span><strong className="text-foreground">Site:</strong> {sosSite}</span>
                    <span><strong className="text-foreground">Trigger:</strong> {format(new Date(alert.created_at), "yyyy-MM-dd HH:mm:ss")}</span>
                    <span><strong className="text-foreground">Status:</strong> {sosStatus}</span>
                  </div>
                )}
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
                        <>
                          <button
                            type="button"
                            onClick={() => acknowledgeSosAlert(alert.id)}
                            className="inline-flex h-6 items-center rounded-md border border-border px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/50"
                          >
                            Acknowledge
                          </button>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => resolveAlert(alert)}
                              className="inline-flex h-6 items-center rounded-md border border-warning/30 px-2 text-[10px] font-medium text-warning transition-colors hover:bg-warning/10"
                            >
                              Resolve SOS
                            </button>
                          ) : (
                            <span className="text-[10px] font-medium text-muted-foreground">Management access required</span>
                          )}
                        </>
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
