import { motion } from "framer-motion";
import { CheckCircle2, MapPin, Scan, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { useScanLogs, useIncidents, usePatrols } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";

type ActivityType = "all" | "scan" | "incident" | "patrol";

type ActivityItem = {
  id: string;
  type: ActivityType;
  action: string;
  detail: string;
  time: Date;
  icon: typeof Scan;
};

const toEndOfDay = (date: string) => new Date(date + "T23:59:59.999");
const toStartOfDay = (date: string) => new Date(date + "T00:00:00.000");

const ActivityFeed = () => {
  const { data: scans = [] } = useScanLogs();
  const { data: incidents = [] } = useIncidents();
  const { data: patrols = [] } = usePatrols();
  const [activityType, setActivityType] = useState<ActivityType>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const activities = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    scans.forEach((s) => {
      items.push({
        id: "scan-" + s.id,
        type: "scan",
        action: "NFC scan completed",
        detail: (s.guards?.full_name || "Guard") + " at " + (s.checkpoints?.name || "Checkpoint"),
        time: new Date(s.scanned_at),
        icon: Scan,
      });
    });

    incidents.forEach((inc) => {
      items.push({
        id: "inc-" + inc.id,
        type: "incident",
        action: "Incident filed",
        detail: inc.title,
        time: new Date(inc.created_at),
        icon: inc.severity === "high" || inc.severity === "critical" ? AlertTriangle : FileText,
      });
    });

    patrols.forEach((p) => {
      const isComplete = p.status === "completed";
      items.push({
        id: "patrol-" + p.id,
        type: "patrol",
        action: isComplete ? "Patrol completed" : p.status === "in_progress" ? "Patrol started" : "Patrol scheduled",
        detail: p.name + (p.guards?.full_name ? " - " + p.guards.full_name : ""),
        time: new Date(p.updated_at),
        icon: isComplete ? CheckCircle2 : MapPin,
      });
    });

    const from = startDate ? toStartOfDay(startDate).getTime() : null;
    const to = endDate ? toEndOfDay(endDate).getTime() : null;

    return items
      .filter((item) => activityType === "all" || item.type === activityType)
      .filter((item) => (from == null ? true : item.time.getTime() >= from))
      .filter((item) => (to == null ? true : item.time.getTime() <= to))
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, 15);
  }, [activityType, endDate, incidents, patrols, scans, startDate]);

  const resetFilters = () => {
    setActivityType("all");
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="border-b border-border/50 px-5 py-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-heading text-sm font-semibold text-foreground">Activity Feed</h3>
            <button
              type="button"
              onClick={resetFilters}
              className="flex h-8 items-center gap-1 rounded-md border border-border/50 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Type
              <select
                value={activityType}
                onChange={(event) => setActivityType(event.target.value as ActivityType)}
                className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs normal-case text-foreground outline-none"
              >
                <option value="all">All Activity</option>
                <option value="scan">NFC Scans</option>
                <option value="incident">Incidents</option>
                <option value="patrol">Patrols</option>
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Start Date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs normal-case text-foreground outline-none"
              />
            </label>
            <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              End Date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs normal-case text-foreground outline-none"
              />
            </label>
          </div>
        </div>
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
