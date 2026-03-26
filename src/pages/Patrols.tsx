import { motion } from "framer-motion";
import { MapPin, Clock, CheckCircle2, AlertTriangle, Play, Pause } from "lucide-react";

const patrols = [
  { id: "P-001", name: "Building A — Night Shift", status: "active", progress: 78, guard: "John D.", checkpoints: "7/9", startTime: "22:00", eta: "06:00" },
  { id: "P-002", name: "Warehouse 3 — Evening", status: "active", progress: 45, guard: "Maria S.", checkpoints: "4/9", startTime: "18:00", eta: "02:00" },
  { id: "P-003", name: "Parking Lot C", status: "delayed", progress: 30, guard: "Alex K.", checkpoints: "2/7", startTime: "20:00", eta: "04:00" },
  { id: "P-004", name: "Zone B Perimeter", status: "completed", progress: 100, guard: "Sam W.", checkpoints: "11/11", startTime: "14:00", eta: "22:00" },
  { id: "P-005", name: "Main Gate — Day Shift", status: "scheduled", progress: 0, guard: "Chris L.", checkpoints: "0/6", startTime: "06:00", eta: "14:00" },
];

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  active: { color: "text-success", bg: "bg-success/10", label: "Active" },
  delayed: { color: "text-warning", bg: "bg-warning/10", label: "Delayed" },
  completed: { color: "text-primary", bg: "bg-primary/10", label: "Completed" },
  scheduled: { color: "text-muted-foreground", bg: "bg-muted", label: "Scheduled" },
};

const Patrols = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Patrol Management</h2>
          <p className="text-sm text-muted-foreground">Monitor and manage all active patrol routes</p>
        </div>
        <button className="flex h-9 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          <Play className="h-4 w-4" />
          New Patrol
        </button>
      </div>

      <div className="space-y-3">
        {patrols.map((patrol, i) => {
          const status = statusConfig[patrol.status];
          return (
            <motion.div
              key={patrol.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card p-4 lg:p-5"
            >
              <div className="flex items-center gap-3 lg:gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 lg:h-10 lg:w-10">
                  <MapPin className="h-4 w-4 text-primary lg:h-5 lg:w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-heading text-sm font-semibold text-foreground">{patrol.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.color}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Guard: {patrol.guard} · {patrol.id}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4 pl-12 lg:pl-14">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-foreground">{patrol.checkpoints}</span>
                </div>

                <div className="w-24 lg:w-32">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>{patrol.progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        patrol.status === "delayed" ? "bg-warning" : "bg-primary"
                      }`}
                      style={{ width: `${patrol.progress}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {patrol.startTime} — {patrol.eta}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default Patrols;
