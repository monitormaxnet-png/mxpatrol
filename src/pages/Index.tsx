import { Users, CheckCircle2, AlertTriangle, Scan } from "lucide-react";
import StatCard from "@/components/dashboard/StatCard";
import LiveMap from "@/components/dashboard/LiveMap";
import AlertsFeed from "@/components/dashboard/AlertsFeed";
import ActivityFeed from "@/components/dashboard/ActivityFeed";
import AIInsightsCard from "@/components/dashboard/AIInsightsCard";
import { useGuards, useAlerts, useScanLogs, useCheckpoints, useRealtimeSubscriptions } from "@/hooks/useDashboardData";

const Index = () => {
  useRealtimeSubscriptions();

  const { data: guards = [] } = useGuards();
  const { data: alerts = [] } = useAlerts();
  const { data: scans = [] } = useScanLogs();
  const { data: checkpoints = [] } = useCheckpoints();

  const activeGuards = guards.filter((g) => g.is_active).length;
  const totalCheckpoints = checkpoints.length;
  const scansToday = scans.length;
  const unreadAlerts = alerts.filter((a) => !a.is_read).length;
  const criticalAlerts = alerts.filter((a) => a.severity === "critical" && !a.is_read).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Command Center</h2>
        <p className="text-sm text-muted-foreground">Real-time patrol intelligence and monitoring</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Guards" value={activeGuards} change={`${guards.length} total`} changeType="positive" icon={Users} />
        <StatCard
          title="Checkpoints"
          value={totalCheckpoints}
          change={`${scansToday} scans today`}
          changeType="positive"
          icon={CheckCircle2}
        />
        <StatCard
          title="Active Alerts"
          value={unreadAlerts}
          change={criticalAlerts > 0 ? `${criticalAlerts} critical` : "All clear"}
          changeType={criticalAlerts > 0 ? "negative" : "positive"}
          icon={AlertTriangle}
        />
        <StatCard title="NFC Scans" value={scansToday} change="Recent scans" changeType="positive" icon={Scan} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LiveMap />
        </div>
        <div className="max-h-[420px]">
          <AlertsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AIInsightsCard />
        <ActivityFeed />
      </div>
    </div>
  );
};

export default Index;
