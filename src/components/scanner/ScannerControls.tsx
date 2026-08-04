import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Battery, BatteryCharging, BatteryLow, Bell, BellOff, CheckCircle2, Clock, MapPin, RefreshCw, ShieldCheck, Smartphone, Wifi, WifiOff } from "lucide-react";
import type { DeviceBatterySnapshot } from "@/lib/deviceBattery";

interface ScannerControlsProps {
  guardName: string | null;
  guardBadge?: string | null;
  gps: { lat: number; lng: number; accuracy?: number | null } | null;
  gpsStatus: "idle" | "capturing" | "available" | "pending" | "unavailable";
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  onSync: () => void;
  mode?: "guard" | "admin";
  companyLabel?: string | null;
  siteLabel?: string | null;
  lastScanLabel?: string | null;
  lastSyncAt?: string | null;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  battery?: DeviceBatterySnapshot | null;
}

const ScannerControls = ({
  guardName,
  guardBadge,
  gps,
  gpsStatus,
  isOnline,
  pendingCount,
  syncing,
  onSync,
  mode = "admin",
  companyLabel,
  siteLabel,
  lastScanLabel,
  lastSyncAt,
  soundEnabled = true,
  onSoundToggle,
  battery,
}: ScannerControlsProps) => {
  const gpsLabel = useMemo(() => gps
    ? "GPS"
    : gpsStatus === "capturing"
      ? "GPS..."
      : gpsStatus === "pending"
        ? "GPS WAIT"
        : gpsStatus === "unavailable"
          ? "NO GPS"
          : "GPS", [gps, gpsStatus]);

  if (mode === "guard") {
    return (
      <div className="mx-auto flex w-full max-w-[22rem] items-center justify-center gap-2 rounded-full border border-emerald-300/20 bg-black/34 px-3 py-2 text-[10px] font-black uppercase tracking-[0.13em] text-white/86 shadow-[0_0_24px_rgba(34,197,94,0.12)] backdrop-blur-[2px]">
        <CompactStatus active={gpsStatus === "available" || gpsStatus === "capturing"} tone={gpsStatus === "unavailable" ? "error" : "success"} label={gpsLabel} pulse={gpsStatus === "capturing"} />
        <span className="h-4 w-px bg-white/16" />
        <CompactStatus active={isOnline} tone={isOnline ? "success" : "warning"} label={isOnline ? "ONLINE" : "OFFLINE"} />
        <span className="h-4 w-px bg-white/16" />
        <CompactStatus active={pendingCount === 0 && !syncing} tone={pendingCount > 0 ? "warning" : "success"} label={syncing ? "SYNC..." : `SYNC ${pendingCount}`} pulse={syncing} />
      </div>
    );
  }

  const gpsDetailLabel = gps
    ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}${gps.accuracy != null ? ` +/-${Math.round(gps.accuracy)}m` : ""}`
    : gpsStatus === "capturing"
      ? "Getting GPS..."
      : gpsStatus === "pending"
        ? "GPS pending"
        : gpsStatus === "unavailable"
          ? "GPS unavailable"
          : "GPS ready";

  const lastSyncLabel = lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Waiting";
  const batteryLabel = battery?.level != null
    ? `${battery.level}%${battery.charging ? " charging" : ""}`
    : "Battery pending";
  const batteryTone = battery?.level == null
    ? "muted"
    : battery.charging || battery.level > 35
      ? "success"
      : battery.level <= 20
        ? "warning"
        : "primary";
  const BatteryIcon = battery?.charging ? BatteryCharging : battery?.level != null && battery.level <= 20 ? BatteryLow : Battery;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatusTile icon={Smartphone} label="Device" value={guardName || guardBadge || "RG360"} tone="primary" />
        <StatusTile icon={MapPin} label="Site" value={siteLabel || "Unassigned"} tone={siteLabel ? "success" : "warning"} />
        <StatusTile icon={Clock} label="Last Scan" value={lastScanLabel || "Ready"} tone="muted" />
        <StatusTile icon={CheckCircle2} label="Last Sync" value={syncing ? "Syncing..." : lastSyncLabel} tone={syncing ? "primary" : "muted"} spin={syncing} />
        <StatusTile icon={BatteryIcon} label="Battery" value={batteryLabel} tone={batteryTone} />
      </div>

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
        <Badge variant="outline" className="gap-1 text-[10px] border-primary/30 text-primary">
          <MapPin className={`h-2.5 w-2.5 ${gpsStatus === "capturing" ? "animate-pulse" : ""}`} />
          {gpsDetailLabel}
        </Badge>
        {companyLabel && (
          <Badge variant="outline" className="text-[10px] border-border/60 text-muted-foreground">
            {companyLabel}
          </Badge>
        )}
        {pendingCount > 0 && (
          <Badge variant="outline" className="gap-1.5 border-warning/30 text-warning text-[10px]">
            {pendingCount} pending offline
          </Badge>
        )}
        {pendingCount === 0 && isOnline && (
          <Badge variant="outline" className="gap-1.5 border-success/30 text-success text-[10px]">
            Synced
          </Badge>
        )}
        {onSoundToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSoundToggle}
            className="h-6 gap-1 px-2 text-[10px]"
          >
            {soundEnabled ? <Bell className="h-2.5 w-2.5" /> : <BellOff className="h-2.5 w-2.5" />}
            Sound {soundEnabled ? "On" : "Off"}
          </Button>
        )}
        {mode === "admin" && pendingCount > 0 && isOnline && (
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
      </div>

      {mode === "admin" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Guard On Duty</Label>
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {guardName || "No guard assigned to this login"}
            </span>
            {guardBadge && <span className="text-xs text-muted-foreground">{guardBadge}</span>}
          </div>
        </div>
      )}
    </div>
  );
};

const CompactStatus = ({ active, label, tone, pulse = false }: { active: boolean; label: string; tone: "success" | "warning" | "error"; pulse?: boolean }) => {
  const dot = tone === "success" ? "bg-emerald-300" : tone === "warning" ? "bg-amber-300" : "bg-red-400";
  const text = tone === "success" ? "text-emerald-100" : tone === "warning" ? "text-amber-100" : "text-red-100";

  return (
    <span className={`inline-flex items-center gap-1.5 ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${active || pulse ? "animate-pulse" : "opacity-55"}`} />
      {label}
    </span>
  );
};

const StatusTile = ({
  icon: Icon,
  label,
  value,
  tone,
  spin = false,
}: {
  icon: typeof Smartphone;
  label: string;
  value: string;
  tone: "primary" | "success" | "warning" | "muted";
  spin?: boolean;
}) => {
  const toneClass = {
    primary: "text-primary bg-primary/10 border-primary/20",
    success: "text-success bg-success/10 border-success/20",
    warning: "text-warning bg-warning/10 border-warning/20",
    muted: "text-muted-foreground bg-muted/20 border-border/50",
  }[tone];

  return (
    <div className="rounded-xl border border-emerald-300/15 bg-black/38 p-2.5 shadow-[inset_0_0_18px_rgba(16,185,129,0.04)]">
      <div className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-md border ${toneClass}`}>
        <Icon className={`h-3.5 w-3.5 ${spin ? "animate-spin" : ""}`} />
      </div>
      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="truncate text-sm font-black text-white/90" title={value}>{value}</p>
    </div>
  );
};

export default memo(ScannerControls);
