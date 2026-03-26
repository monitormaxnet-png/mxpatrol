import { motion } from "framer-motion";
import { AlertTriangle, FileText, Clock, MapPin, ChevronRight } from "lucide-react";

const incidents = [
  { id: "INC-042", title: "Broken window — Parking Lot C", severity: "high", guard: "Alex Kim", time: "10 min ago", zone: "Zone C", status: "open", aiSeverity: "Critical — immediate action required" },
  { id: "INC-041", title: "Suspicious person near Gate B", severity: "medium", guard: "John Doe", time: "45 min ago", zone: "Zone A", status: "investigating", aiSeverity: "Monitor — escalate if repeated" },
  { id: "INC-040", title: "Light outage in corridor 3", severity: "low", guard: "Maria Santos", time: "2h ago", zone: "Building A", status: "resolved", aiSeverity: "Maintenance issue — non-urgent" },
  { id: "INC-039", title: "Unauthorized vehicle in restricted area", severity: "high", guard: "Sam Wilson", time: "3h ago", zone: "Zone B", status: "open", aiSeverity: "High risk — verify credentials" },
  { id: "INC-038", title: "Fire alarm trigger — false alarm", severity: "medium", guard: "Nina Patel", time: "5h ago", zone: "Building B", status: "resolved", aiSeverity: "System check recommended" },
];

const severityColors: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  low: "bg-muted text-muted-foreground border-border",
};

const statusColors: Record<string, string> = {
  open: "text-destructive",
  investigating: "text-warning",
  resolved: "text-success",
};

const Incidents = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Incident Reports</h2>
          <p className="text-sm text-muted-foreground">AI-analyzed security incidents with severity classification</p>
        </div>
        <button className="flex h-9 items-center gap-2 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90">
          <AlertTriangle className="h-4 w-4" />
          Report Incident
        </button>
      </div>

      <div className="space-y-3">
        {incidents.map((incident, i) => (
          <motion.div
            key={incident.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-5"
          >
            <div className="flex items-start gap-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${severityColors[incident.severity]}`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-heading text-sm font-semibold text-foreground">{incident.title}</p>
                  <span className={`text-[10px] font-medium uppercase ${statusColors[incident.status]}`}>
                    {incident.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{incident.id}</span>
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{incident.zone}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{incident.time}</span>
                  <span>Guard: {incident.guard}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-md bg-primary/5 px-3 py-1.5">
                  <FileText className="h-3 w-3 text-primary" />
                  <span className="text-xs text-primary">AI: {incident.aiSeverity}</span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Incidents;
