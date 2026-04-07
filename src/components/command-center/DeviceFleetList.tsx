import { useDevices } from "@/hooks/useDashboardData";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Wifi, WifiOff, Battery, Smartphone, Tablet, ScanLine, Monitor, Shield,
} from "lucide-react";

const typeIcons: Record<string, typeof Smartphone> = {
  mobile: Smartphone,
  tablet: Tablet,
  nfc_reader: ScanLine,
  pda: Monitor,
};

export default function DeviceFleetList() {
  const { data: devices = [] } = useDevices();

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2 pr-4">
        {devices.map((device: any) => {
          const isOnline = device.status === "online";
          const Icon = typeIcons[device.device_type] || Smartphone;
          const battery = device.battery_level ?? null;
          const compliance = Number(device.compliance_score) || 100;

          return (
            <div
              key={device.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors"
            >
              {/* Status dot + icon */}
              <div className="relative">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${isOnline ? "bg-success/10" : "bg-muted"}`}>
                  <Icon className={`h-4 w-4 ${isOnline ? "text-success" : "text-muted-foreground"}`} />
                </div>
                <span
                  className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                    isOnline ? "bg-success" : "bg-muted-foreground"
                  }`}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {device.device_name || device.device_identifier}
                  </p>
                  {device.app_type && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {device.app_type === "admin_app" ? "ADM" : "GRD"}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{device.guards?.full_name || "Unassigned"}</span>
                  <span>•</span>
                  <span>
                    {device.last_seen_at
                      ? formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true })
                      : "Never seen"}
                  </span>
                </div>
              </div>

              {/* Battery + Compliance */}
              <div className="flex items-center gap-3">
                {battery !== null && (
                  <div className="flex items-center gap-1 text-xs">
                    <Battery className={`h-3 w-3 ${battery <= 20 ? "text-destructive" : "text-success"}`} />
                    <span className="text-muted-foreground">{battery}%</span>
                  </div>
                )}
                <div className="hidden sm:flex items-center gap-1.5 min-w-[80px]">
                  <Shield className="h-3 w-3 text-primary" />
                  <Progress
                    value={compliance}
                    className="h-1.5 flex-1"
                  />
                  <span className="text-[10px] text-muted-foreground w-7 text-right">{compliance}%</span>
                </div>
              </div>
            </div>
          );
        })}

        {devices.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No devices registered
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
