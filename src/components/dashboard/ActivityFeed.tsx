import { motion } from "framer-motion";
import { CheckCircle2, MapPin, Scan, FileText, AlertTriangle } from "lucide-react";
import { useScanLogs, useIncidents, usePatrols } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";

type ActivityItem = {
  id: string;
  action: string;
  detail: string;
  time: Date;
  icon: typeof Scan;
};

const ActivityFeed = () => {
  const { data: scans = [] } = useScanLogs();
  const { data: incidents = [] } = useIncidents();
  const { data: patrols = [] } = usePatrols();

  const activities = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    scans.forEach((s) => {
      items.push({
        id: `scan-${s.id}`,
        action: "NFC scan completed",
        detail: `${s.guards?.full_name || "Guard"} at ${s.checkpoints?.name || "Checkpoint"}`,
        time: new Date(s.scanned_at),
        icon: Scan,
      });
    });

    incidents.slice(0, 5).forEach((inc) => {
      items.push({
        id: `inc-${inc.id}`,
        action: "Incident filed",
        detail: inc.title,
        time: new Date(inc.created_at),
        icon: inc.severity === "high" || inc.severity === "critical" ? AlertTriangle : FileText,
      });
    });

    patrols.slice(0, 5).forEach((p) => {
      const isComplete = p.status === "completed";
      items.push({
        id: `patrol-${p.id}`,
        action: isComplete ? "Patrol completed" : p.status === "in_progress" ? "Patrol started" : "Patrol scheduled",
        detail: `${p.name}${p.guards?.full_name ? ` — ${p.guards.full_name}` : ""}`,
        time: new Date(p.updated_at),
        icon: isComplete ? CheckCircle2 : MapPin,
      });
    });

    return items.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 15);
  }, [scans, incidents, patrols]);

  return (
    <div className="glass-card flex flex-col">
      <div className="border-b border-border/50 px-5 py-4">
        <h3 className="font-heading text-sm font-semibold text-foreground">Activity Feed</h3>
      </div>
      <div className="flex-1 divide-y divide-border/30 overflow-auto">
        {activities.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No recent activity</div>
        )}
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
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatDistanceToNow(item.time, { addSuffix: true })}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default ActivityFeed;
