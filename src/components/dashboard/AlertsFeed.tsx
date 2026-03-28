import { motion } from "framer-motion";
import { AlertTriangle, Clock, Radio, ShieldAlert } from "lucide-react";
import { useAlerts } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";

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

const AlertsFeed = () => {
  const { data: alerts = [], isLoading } = useAlerts();

  return (
    <div className="glass-card flex flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h3 className="font-heading text-sm font-semibold text-foreground">Live Alerts</h3>
        <span className="flex h-5 items-center rounded-full bg-destructive/20 px-2 text-[10px] font-bold text-destructive">
          {alerts.filter((a) => !a.is_read).length} Active
        </span>
      </div>
      <div className="flex-1 divide-y divide-border/30 overflow-auto">
        {isLoading && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">Loading alerts...</div>
        )}
        {!isLoading && alerts.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No alerts — all clear</div>
        )}
        {alerts.map((alert, i) => {
          const Icon = iconMap[alert.type] || AlertTriangle;
          const color = colorMap[alert.type] || "text-muted-foreground";
          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/30"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{alert.message}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default AlertsFeed;
