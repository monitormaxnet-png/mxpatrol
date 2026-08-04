import { useEffect, useRef, useState } from "react";
import { Battery, ChevronRight, Clock, Radio } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DevicePosition } from "@/hooks/useDeviceMapData";

interface DevicePositionsPanelProps {
  positions: DevicePosition[];
  onSelectDevice?: (deviceId: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DevicePositionsPanel = ({ positions, onSelectDevice }: DevicePositionsPanelProps) => {
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const prevPositionsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const prev = prevPositionsRef.current;
    const newHighlights = new Set<string>();

    positions.forEach((device) => {
      const key = `${device.lat},${device.lng}`;
      const oldKey = prev.get(device.device_identifier);
      if (oldKey && oldKey !== key) {
        newHighlights.add(device.device_identifier);
      }
      prev.set(device.device_identifier, key);
    });

    if (newHighlights.size > 0) {
      setHighlighted(newHighlights);
      const timer = setTimeout(() => setHighlighted(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [positions]);

  const sorted = [...positions].sort(
    (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-success" />
          <h4 className="text-xs font-semibold text-foreground">Patrol Devices</h4>
        </div>
        <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-medium text-success">
          {positions.length} active
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {sorted.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No device positions yet
            </p>
          )}
          {sorted.map((device) => {
            const isHighlighted = highlighted.has(device.device_identifier);
            return (
              <button
                key={device.device_identifier}
                onClick={() => onSelectDevice?.(device.device_identifier)}
                className={`group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-all duration-300 ${
                  isHighlighted ? "bg-success/15 ring-1 ring-success/40" : "hover:bg-muted/50"
                }`}
              >
                <div className="relative shrink-0">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full bg-success/20 text-success ${
                      isHighlighted ? "animate-pulse" : ""
                    }`}
                  >
                    <Radio className="h-3.5 w-3.5" />
                  </div>
                  {device.status === "online" && (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-background" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {device.device_name || device.device_identifier}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {timeAgo(device.last_seen_at)}
                    </span>
                    {device.battery_level != null && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Battery className="h-2.5 w-2.5" />
                        {device.battery_level}%
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default DevicePositionsPanel;
