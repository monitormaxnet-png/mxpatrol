import { formatDistanceToNow, format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Battery, Wifi, WifiOff, Smartphone, Tablet, ScanLine, Monitor, MapPin, User, Hash, Clock, CalendarDays } from "lucide-react";
import DevicePairingCard from "./DevicePairingCard";

const typeIcons: Record<string, typeof Smartphone> = {
  mobile: Smartphone,
  tablet: Tablet,
  nfc_reader: ScanLine,
  pda: Monitor,
};

const typeLabels: Record<string, string> = {
  mobile: "Mobile Phone",
  pda: "PDA Scanner",
  nfc_reader: "NFC Reader",
  tablet: "Tablet",
};

interface Props {
  device: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DeviceDetailSheet({ device, open, onOpenChange }: Props) {
  if (!device) return null;

  const Icon = typeIcons[device.device_type] || Smartphone;
  const isOnline = device.status === "online";
  const batteryLow = (device.battery_level ?? 100) <= 30;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isOnline ? "bg-success/10" : "bg-muted"}`}>
              <Icon className={`h-5 w-5 ${isOnline ? "text-success" : "text-muted-foreground"}`} />
            </div>
            <div>
              <p>{device.device_name || device.device_identifier}</p>
              <p className="text-xs font-normal text-muted-foreground">{typeLabels[device.device_type] || device.device_type}</p>
            </div>
          </SheetTitle>
          <SheetDescription>Device details, pairing status, and activity</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status */}
          <div className="flex items-center gap-4">
            <Badge variant={isOnline ? "default" : "secondary"} className={isOnline ? "bg-success" : ""}>
              {isOnline ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
              {isOnline ? "Online" : "Offline"}
            </Badge>
            {device.battery_level != null && (
              <div className="flex items-center gap-1 text-sm">
                <Battery className={`h-4 w-4 ${batteryLow ? "text-destructive" : "text-success"}`} />
                <span className="text-muted-foreground">{device.battery_level}%</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Pairing */}
          <div>
            <h4 className="mb-2 text-sm font-medium text-foreground">Pairing Status</h4>
            <DevicePairingCard device={device} />
          </div>

          <Separator />

          {/* Details */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-foreground">Device Information</h4>

            <InfoRow icon={Hash} label="Device ID" value={device.device_identifier} />
            {device.serial_number && <InfoRow icon={Hash} label="Serial / IMEI" value={device.serial_number} />}
            {device.site_location && <InfoRow icon={MapPin} label="Site" value={device.site_location} />}
            <InfoRow icon={User} label="Assigned Guard" value={device.guards?.full_name || "Unassigned"} />
            <InfoRow
              icon={CalendarDays}
              label="Registered"
              value={device.registration_date ? format(new Date(device.registration_date), "MMM d, yyyy") : "—"}
            />
            <InfoRow
              icon={Clock}
              label="Last Seen"
              value={device.last_seen_at ? formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true }) : "Never"}
            />
            {device.notes && (
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm text-foreground">{device.notes}</p>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
