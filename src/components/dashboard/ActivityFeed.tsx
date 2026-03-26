import { motion } from "framer-motion";
import { CheckCircle2, MapPin, Scan, FileText } from "lucide-react";

const activities = [
  { id: 1, action: "NFC scan completed", detail: "Guard #3 at Checkpoint D-2", time: "1 min ago", icon: Scan },
  { id: 2, action: "Patrol completed", detail: "Night shift — Building A", time: "4 min ago", icon: CheckCircle2 },
  { id: 3, action: "Location updated", detail: "Guard #8 — Zone B perimeter", time: "6 min ago", icon: MapPin },
  { id: 4, action: "Incident filed", detail: "Broken window — Parking Lot C", time: "10 min ago", icon: FileText },
  { id: 5, action: "NFC scan completed", detail: "Guard #15 at Checkpoint A-7", time: "11 min ago", icon: Scan },
  { id: 6, action: "Patrol started", detail: "Evening shift — Warehouse 3", time: "14 min ago", icon: MapPin },
];

const ActivityFeed = () => {
  return (
    <div className="glass-card flex flex-col">
      <div className="border-b border-border/50 px-5 py-4">
        <h3 className="font-heading text-sm font-semibold text-foreground">Activity Feed</h3>
      </div>
      <div className="flex-1 divide-y divide-border/30 overflow-auto">
        {activities.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-start gap-3 px-5 py-3"
          >
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <item.icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{item.action}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{item.time}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default ActivityFeed;
