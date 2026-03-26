import { motion } from "framer-motion";
import { User, Star, Shield, MapPin, Battery, Wifi } from "lucide-react";

const guards = [
  { id: "G-03", name: "John Doe", zone: "Building A", status: "on-patrol", score: 94, battery: 82, signal: "strong" },
  { id: "G-08", name: "Maria Santos", zone: "Warehouse 3", status: "on-patrol", score: 88, battery: 65, signal: "strong" },
  { id: "G-12", name: "Alex Kim", zone: "Parking Lot C", status: "delayed", score: 72, battery: 45, signal: "weak" },
  { id: "G-15", name: "Sam Wilson", zone: "Zone B", status: "on-patrol", score: 96, battery: 90, signal: "strong" },
  { id: "G-07", name: "Chris Lee", zone: "Main Gate", status: "offline", score: 85, battery: 12, signal: "none" },
  { id: "G-21", name: "Nina Patel", zone: "Building B", status: "on-break", score: 91, battery: 70, signal: "strong" },
];

const statusColors: Record<string, string> = {
  "on-patrol": "bg-success text-success-foreground",
  "delayed": "bg-warning text-warning-foreground",
  "offline": "bg-muted text-muted-foreground",
  "on-break": "bg-primary/20 text-primary",
};

const Guards = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Guard Management</h2>
        <p className="text-sm text-muted-foreground">Track performance and real-time status of all guards</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {guards.map((guard, i) => (
          <motion.div
            key={guard.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-foreground">{guard.name}</p>
                  <p className="text-xs text-muted-foreground">{guard.id}</p>
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusColors[guard.status]}`}>
                {guard.status.replace("-", " ")}
              </span>
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {guard.zone}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-4">
              <div className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 text-warning" />
                <span className="font-heading text-sm font-bold text-foreground">{guard.score}</span>
                <span className="text-[10px] text-muted-foreground">score</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <Battery className={`h-3.5 w-3.5 ${guard.battery > 30 ? "text-success" : "text-destructive"}`} />
                  <span className="text-xs text-muted-foreground">{guard.battery}%</span>
                </div>
                <div className="flex items-center gap-1">
                  <Wifi className={`h-3.5 w-3.5 ${
                    guard.signal === "strong" ? "text-success" : guard.signal === "weak" ? "text-warning" : "text-muted-foreground"
                  }`} />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Guards;
