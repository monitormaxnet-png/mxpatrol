import { motion } from "framer-motion";
import { AlertTriangle, Clock, Radio, ShieldAlert } from "lucide-react";

const alerts = [
  { id: 1, type: "missed", message: "Guard #12 missed Checkpoint B-4", time: "2 min ago", icon: Clock, color: "text-warning" },
  { id: 2, type: "panic", message: "Panic button triggered — Zone C", time: "5 min ago", icon: ShieldAlert, color: "text-destructive" },
  { id: 3, type: "offline", message: "Device GD-089 went offline", time: "8 min ago", icon: Radio, color: "text-muted-foreground" },
  { id: 4, type: "anomaly", message: "AI: Irregular patrol pattern detected", time: "12 min ago", icon: AlertTriangle, color: "text-warning" },
  { id: 5, type: "missed", message: "Guard #7 late to Checkpoint A-1", time: "15 min ago", icon: Clock, color: "text-warning" },
];

const AlertsFeed = () => {
  return (
    <div className="glass-card flex flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h3 className="font-heading text-sm font-semibold text-foreground">Live Alerts</h3>
        <span className="flex h-5 items-center rounded-full bg-destructive/20 px-2 text-[10px] font-bold text-destructive">
          {alerts.length} Active
        </span>
      </div>
      <div className="flex-1 divide-y divide-border/30 overflow-auto">
        {alerts.map((alert, i) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/30"
          >
            <alert.icon className={`mt-0.5 h-4 w-4 shrink-0 ${alert.color}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{alert.message}</p>
              <p className="text-xs text-muted-foreground">{alert.time}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default AlertsFeed;
