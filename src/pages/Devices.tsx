import { motion } from "framer-motion";
import { Radio, Battery, Wifi, Smartphone, RefreshCw } from "lucide-react";

const devices = [
  { id: "GD-001", guard: "John Doe", model: "Samsung A54", battery: 82, signal: "strong", status: "online", lastSync: "1 min ago" },
  { id: "GD-002", guard: "Maria Santos", model: "iPhone 15", battery: 65, signal: "strong", status: "online", lastSync: "2 min ago" },
  { id: "GD-003", guard: "Alex Kim", model: "Pixel 8", battery: 45, signal: "weak", status: "online", lastSync: "5 min ago" },
  { id: "GD-004", guard: "Sam Wilson", model: "Samsung A54", battery: 90, signal: "strong", status: "online", lastSync: "1 min ago" },
  { id: "GD-005", guard: "Chris Lee", model: "iPhone 14", battery: 12, signal: "none", status: "offline", lastSync: "42 min ago" },
  { id: "GD-006", guard: "Nina Patel", model: "Pixel 7a", battery: 70, signal: "strong", status: "online", lastSync: "3 min ago" },
];

const Devices = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Device Management</h2>
        <p className="text-sm text-muted-foreground">Monitor guard devices, battery levels, and connectivity</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {devices.map((device, i) => (
          <motion.div
            key={device.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  device.status === "online" ? "bg-success/10" : "bg-muted"
                }`}>
                  <Smartphone className={`h-5 w-5 ${device.status === "online" ? "text-success" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{device.id}</p>
                  <p className="text-xs text-muted-foreground">{device.model}</p>
                </div>
              </div>
              <span className={`h-2 w-2 rounded-full ${device.status === "online" ? "bg-success" : "bg-muted-foreground"}`} />
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              Assigned to: <span className="text-foreground">{device.guard}</span>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3">
              <div className="flex items-center gap-1">
                <Battery className={`h-4 w-4 ${device.battery > 30 ? "text-success" : "text-destructive"}`} />
                <span className="text-xs text-muted-foreground">{device.battery}%</span>
              </div>
              <div className="flex items-center gap-1">
                <Wifi className={`h-4 w-4 ${
                  device.signal === "strong" ? "text-success" : device.signal === "weak" ? "text-warning" : "text-muted-foreground"
                }`} />
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3" />
                {device.lastSync}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Devices;
