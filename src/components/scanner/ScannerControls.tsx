import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MapPin, Wifi, WifiOff, RefreshCw } from "lucide-react";

interface ScannerControlsProps {
  guards: Array<{ id: string; full_name: string; badge_number: string }>;
  selectedGuard: string;
  onGuardChange: (id: string) => void;
  gps: { lat: number; lng: number } | null;
  gpsLoading: boolean;
  onCaptureGps: () => void;
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  onSync: () => void;
}

const ScannerControls = ({
  guards,
  selectedGuard,
  onGuardChange,
  gps,
  gpsLoading,
  onCaptureGps,
  isOnline,
  pendingCount,
  syncing,
  onSync,
}: ScannerControlsProps) => {
  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {isOnline ? (
          <Badge variant="default" className="gap-1.5 bg-success/20 text-success border-success/30 text-[10px]">
            <Wifi className="h-2.5 w-2.5" /> Online
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1.5 text-[10px]">
            <WifiOff className="h-2.5 w-2.5" /> Offline
          </Badge>
        )}
        {pendingCount > 0 && (
          <Badge variant="outline" className="gap-1.5 border-warning/30 text-warning text-[10px]">
            {pendingCount} pending
          </Badge>
        )}
        {pendingCount > 0 && isOnline && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSync}
            disabled={syncing}
            className="h-6 gap-1 px-2 text-[10px]"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${syncing ? "animate-spin" : ""}`} />
            Sync
          </Button>
        )}
        {gps && (
          <Badge variant="outline" className="gap-1 text-[10px] border-primary/30 text-primary">
            <MapPin className="h-2.5 w-2.5" />
            {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}
          </Badge>
        )}
      </div>

      {/* Guard selector */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Guard on Duty</Label>
        <Select value={selectedGuard} onValueChange={onGuardChange}>
          <SelectTrigger className="h-10 bg-card/60 border-border/50">
            <SelectValue placeholder="Select guard" />
          </SelectTrigger>
          <SelectContent>
            {guards.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.full_name} ({g.badge_number})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* GPS button */}
      <Button
        type="button"
        variant="outline"
        onClick={onCaptureGps}
        disabled={gpsLoading}
        className="w-full gap-2 h-9 text-xs"
        size="sm"
      >
        <MapPin className="h-3.5 w-3.5" />
        {gpsLoading ? "Capturing GPS..." : gps ? "Location Captured ✓" : "Capture GPS Location"}
      </Button>
    </div>
  );
};

export default ScannerControls;
