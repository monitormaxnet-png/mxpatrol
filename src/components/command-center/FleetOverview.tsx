import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Smartphone, Wifi, WifiOff, BatteryWarning, Shield, Activity,
  Monitor, AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useFleetStats } from "@/hooks/useDeviceCommands";

const statItems = [
  { key: "total", label: "Total Fleet", icon: Smartphone, color: "text-primary" },
  { key: "online", label: "Online", icon: Wifi, color: "text-success" },
  { key: "offline", label: "Offline", icon: WifiOff, color: "text-muted-foreground" },
  { key: "lowBattery", label: "Low Battery", icon: BatteryWarning, color: "text-destructive" },
  { key: "stale", label: "Stale (30m+)", icon: AlertTriangle, color: "text-warning" },
  { key: "avgCompliance", label: "Avg Compliance", icon: Shield, color: "text-primary", suffix: "%" },
] as const;

export default function FleetOverview() {
  const { data: stats } = useFleetStats();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {statItems.map((item, i) => {
        const value = stats?.[item.key] ?? 0;
        const Icon = item.icon;
        return (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="glass-card">
              <CardContent className="flex flex-col items-center gap-1 p-4">
                <Icon className={`h-5 w-5 ${item.color}`} />
                <span className="text-2xl font-bold text-foreground">
                  {value}{"suffix" in item ? item.suffix : ""}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider text-center">
                  {item.label}
                </span>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
