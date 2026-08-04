import { lazy, Suspense, useState } from "react";
import { CheckCircle2, Radio, Scan, Wifi, WifiOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import StatCard from "@/components/dashboard/StatCard";
import AlertsFeed from "@/components/dashboard/AlertsFeed";
import ActivityFeed from "@/components/dashboard/ActivityFeed";
import AIInsightsCard from "@/components/dashboard/AIInsightsCard";
import LivePatrolSession from "@/components/dashboard/LivePatrolSession";
import PendingUnregisteredCheckpoints from "@/components/dashboard/PendingUnregisteredCheckpoints";
import SessionLogs from "@/components/dashboard/SessionLogs";
import { useCompanyId } from "@/hooks/usePatrolScanData";
import { useDevices, useScanLogs, useCheckpoints, useRealtimeSubscriptions } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import SiteSelector from "@/components/sites/SiteSelector";

const LiveMap = lazy(() => import("@/components/dashboard/LiveMap"));

const Index = () => {
  useRealtimeSubscriptions();
  const [siteId, setSiteId] = useState("all");

  const { data: devices = [] } = useDevices(siteId);
  const { data: scans = [] } = useScanLogs(siteId);
  const { data: checkpoints = [] } = useCheckpoints(siteId);
  const { data: companyId } = useCompanyId();
  const { data: pendingTags = 0 } = useQuery({
    queryKey: ["pending_nfc_tags_count", companyId, siteId],
    queryFn: async () => {
      let query = supabase
        .from("scan_logs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId!)
        .eq("tag_status", "unregistered")
        .is("checkpoint_id", null);
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!companyId,
  });

  const { data: scansToday = 0 } = useQuery({
    queryKey: ["patrol_scans_today", companyId, siteId],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      let query = supabase
        .from("scan_logs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId!)
        .gte("scanned_at", start.toISOString());
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!companyId,
  });

  const activeDevices = devices.length;
  const devicesOnline = devices.filter((device) => device.status === "online").length;
  const devicesOffline = devices.filter((device) => device.status === "offline").length;
  const totalCheckpoints = checkpoints.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Command Center</h2>
          <p className="text-sm text-muted-foreground">Real-time patrol intelligence and monitoring</p>
        </div>
        <SiteSelector value={siteId} onChange={setSiteId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard title="Active Devices" value={activeDevices} change="Patrol hardware" changeType="positive" icon={Radio} />
        <StatCard title="Devices Online" value={devicesOnline} change="Reporting now" changeType="positive" icon={Wifi} />
        <StatCard title="Devices Offline" value={devicesOffline} change="Needs attention" changeType={devicesOffline > 0 ? "negative" : "positive"} icon={WifiOff} />
        <StatCard
          title="Total Checkpoints"
          value={totalCheckpoints}
          change="Registered tags"
          changeType="positive"
          icon={CheckCircle2}
        />
        <StatCard
          title="Patrol Scans Today"
          value={scansToday}
          change={`${scans.length} recent shown`}
          changeType="positive"
          icon={Scan}
        />
        <Link to="/checkpoints" aria-label="Review pending NFC tags" className="rounded-xl focus:outline-none focus:ring-2 focus:ring-ring">
          <StatCard
            title="Pending Tags"
            value={pendingTags}
            change="Unknown NFC scans"
            changeType={pendingTags > 0 ? "negative" : "positive"}
            icon={Scan}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense
            fallback={(
              <div className="glass-card flex min-h-[380px] items-center justify-center text-sm text-muted-foreground">
                Loading live map...
              </div>
            )}
          >
            <LiveMap />
          </Suspense>
        </div>
        <div className="max-h-[420px]">
          <AlertsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LivePatrolSession />
        <ActivityFeed />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SessionLogs />
        <PendingUnregisteredCheckpoints />
      </div>

      <AIInsightsCard />
    </div>
  );
};

export default Index;
