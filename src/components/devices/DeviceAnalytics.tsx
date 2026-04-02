import { Smartphone, Wifi, WifiOff, BatteryWarning, MapPin } from "lucide-react";

interface Props {
  devices: any[];
}

export default function DeviceAnalytics({ devices }: Props) {
  const total = devices.length;
  const online = devices.filter((d) => d.status === "online").length;
  const offline = devices.filter((d) => d.status === "offline").length;
  const lowBattery = devices.filter((d) => (d.battery_level ?? 100) <= 30).length;

  const siteCounts = devices.reduce((acc: Record<string, number>, d) => {
    const site = d.site_location || "Unassigned";
    acc[site] = (acc[site] || 0) + 1;
    return acc;
  }, {});
  const topSite = Object.entries(siteCounts).sort(([, a], [, b]) => (b as number) - (a as number))[0];

  const stats = [
    { label: "Total Devices", value: total, icon: Smartphone, color: "text-primary" },
    { label: "Online", value: online, icon: Wifi, color: "text-success" },
    { label: "Offline", value: offline, icon: WifiOff, color: "text-muted-foreground" },
    { label: "Low Battery", value: lowBattery, icon: BatteryWarning, color: "text-destructive" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="glass-card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
