import { motion } from "framer-motion";
import { Battery, Wifi, Smartphone, RefreshCw, Loader2 } from "lucide-react";
import { useDevices } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";

const Devices = () => {
  const { data: devices = [], isLoading } = useDevices();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Device Management</h2>
        <p className="text-sm text-muted-foreground">Monitor guard devices, battery levels, and connectivity</p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && devices.length === 0 && (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">No devices registered yet</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {devices.map((device, i) => {
          const isOnline = device.status === "online";
          const batteryLow = (device.battery_level ?? 0) <= 30;
          return (
            <motion.div
              key={device.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isOnline ? "bg-success/10" : "bg-muted"}`}>
                    <Smartphone className={`h-5 w-5 ${isOnline ? "text-success" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{device.device_identifier}</p>
                    <p className="text-xs text-muted-foreground">{device.device_name || "Unknown"}</p>
                  </div>
                </div>
                <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-success" : "bg-muted-foreground"}`} />
              </div>

              <div className="mt-3 text-xs text-muted-foreground">
                Assigned to: <span className="text-foreground">{device.guards?.full_name || "Unassigned"}</span>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3">
                <div className="flex items-center gap-1">
                  <Battery className={`h-4 w-4 ${batteryLow ? "text-destructive" : "text-success"}`} />
                  <span className="text-xs text-muted-foreground">{device.battery_level ?? "—"}%</span>
                </div>
                <div className="flex items-center gap-1">
                  <Wifi className={`h-4 w-4 ${isOnline ? "text-success" : "text-muted-foreground"}`} />
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3" />
                  {device.last_seen_at ? formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true }) : "Never"}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default Devices;
