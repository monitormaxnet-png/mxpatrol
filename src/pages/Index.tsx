import { Shield, Users, MapPin, AlertTriangle, CheckCircle2, Scan } from "lucide-react";
import StatCard from "@/components/dashboard/StatCard";
import LiveMap from "@/components/dashboard/LiveMap";
import AlertsFeed from "@/components/dashboard/AlertsFeed";
import ActivityFeed from "@/components/dashboard/ActivityFeed";
import AIInsightsCard from "@/components/dashboard/AIInsightsCard";

const Index = () => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Command Center</h2>
        <p className="text-sm text-muted-foreground">Real-time patrol intelligence and monitoring</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Guards" value={18} change="+2 from last shift" changeType="positive" icon={Users} />
        <StatCard title="Checkpoints Hit" value="142/156" change="91% completion" changeType="positive" icon={CheckCircle2} />
        <StatCard title="Active Alerts" value={3} change="1 critical" changeType="negative" icon={AlertTriangle} />
        <StatCard title="NFC Scans Today" value={284} change="+12% vs yesterday" changeType="positive" icon={Scan} />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Map — takes 2 cols */}
        <div className="lg:col-span-2">
          <LiveMap />
        </div>
        {/* Alerts */}
        <div className="max-h-[420px]">
          <AlertsFeed />
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AIInsightsCard />
        <ActivityFeed />
      </div>
    </div>
  );
};

export default Index;
