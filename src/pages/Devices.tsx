import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Battery, Wifi, WifiOff, Smartphone, Tablet, ScanLine, Monitor,
  RefreshCw, Loader2, Plus, Search, Trash2, Power, PowerOff, MoreHorizontal, Pencil, Eye, MapPin,
} from "lucide-react";
import { useDevices } from "@/hooks/useDashboardData";
import { useUserRole } from "@/hooks/useUserRole";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import DeviceAnalytics from "@/components/devices/DeviceAnalytics";
import DeviceRegistrationDialog from "@/components/devices/DeviceRegistrationDialog";
import DeviceDetailSheet from "@/components/devices/DeviceDetailSheet";
import DevicePairingCard from "@/components/devices/DevicePairingCard";

const typeIcons: Record<string, typeof Smartphone> = {
  mobile: Smartphone, tablet: Tablet, nfc_reader: ScanLine, pda: Monitor,
};
const typeLabels: Record<string, string> = {
  mobile: "Mobile", pda: "PDA", nfc_reader: "NFC Reader", tablet: "Tablet",
};

const Devices = () => {
  const { data: devices = [], isLoading } = useDevices();
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editDevice, setEditDevice] = useState<any>(null);
  const [detailDevice, setDetailDevice] = useState<any>(null);

  const filtered = useMemo(() => {
    return devices.filter((d: any) => {
      const matchSearch =
        !search ||
        d.device_name?.toLowerCase().includes(search.toLowerCase()) ||
        d.device_identifier?.toLowerCase().includes(search.toLowerCase()) ||
        d.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
        d.guards?.full_name?.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || d.status === statusFilter;
      const matchType = typeFilter === "all" || d.device_type === typeFilter;
      return matchSearch && matchStatus && matchType;
    });
  }, [devices, search, statusFilter, typeFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d: any) => d.id)));
    }
  };

  const bulkAction = useMutation({
    mutationFn: async ({ action }: { action: "activate" | "deactivate" | "delete" }) => {
      const ids = Array.from(selected);
      if (action === "delete") {
        const { error } = await supabase.from("devices").delete().in("id", ids);
        if (error) throw error;
      } else {
        const status = action === "activate" ? "online" : "offline";
        const { error } = await supabase.from("devices").update({ status }).in("id", ids);
        if (error) throw error;
      }
    },
    onSuccess: (_, { action }) => {
      toast.success(`Devices ${action === "delete" ? "deleted" : action + "d"} successfully`);
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      setSelected(new Set());
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Device Management</h2>
          <p className="text-sm text-muted-foreground">Register, pair, and monitor patrol devices</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditDevice(null); setRegisterOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Register Device
          </Button>
        )}
      </div>

      <DeviceAnalytics devices={devices} />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search devices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="low_battery">Low Battery</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="mobile">Mobile</SelectItem>
            <SelectItem value="pda">PDA</SelectItem>
            <SelectItem value="nfc_reader">NFC Reader</SelectItem>
            <SelectItem value="tablet">Tablet</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk actions */}
      {isAdmin && selected.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulkAction.mutate({ action: "activate" })}>
            <Power className="mr-1 h-3 w-3" /> Activate
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkAction.mutate({ action: "deactivate" })}>
            <PowerOff className="mr-1 h-3 w-3" /> Deactivate
          </Button>
          <Button size="sm" variant="destructive" onClick={() => bulkAction.mutate({ action: "delete" })}>
            <Trash2 className="mr-1 h-3 w-3" /> Delete
          </Button>
        </motion.div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          {devices.length === 0 ? "No devices registered yet. Click 'Register Device' to add one." : "No devices match your filters."}
        </div>
      )}

      {/* Table */}
      {!isLoading && filtered.length > 0 && (
        <div className="glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {isAdmin && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                )}
                <TableHead>Device</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Pairing</TableHead>
                <TableHead className="hidden md:table-cell">Guard</TableHead>
                <TableHead className="hidden lg:table-cell">Site</TableHead>
                <TableHead className="hidden md:table-cell">Last Seen</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((device: any) => {
                const Icon = typeIcons[device.device_type] || Smartphone;
                const isOnline = device.status === "online";
                const batteryLow = (device.battery_level ?? 100) <= 30;

                return (
                  <TableRow key={device.id}>
                    {isAdmin && (
                      <TableCell>
                        <Checkbox
                          checked={selected.has(device.id)}
                          onCheckedChange={() => toggleSelect(device.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isOnline ? "bg-success/10" : "bg-muted"}`}>
                          <Icon className={`h-4 w-4 ${isOnline ? "text-success" : "text-muted-foreground"}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{device.device_name || device.device_identifier}</p>
                          <p className="text-xs text-muted-foreground">{device.device_identifier}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">{typeLabels[device.device_type] || device.device_type}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={isOnline ? "default" : "secondary"} className={isOnline ? "bg-success text-success-foreground" : ""}>
                          {isOnline ? "Online" : "Offline"}
                        </Badge>
                        {device.battery_level != null && (
                          <span className="flex items-center gap-1">
                            <Battery className={`h-3 w-3 ${batteryLow ? "text-destructive" : "text-success"}`} />
                            <span className="text-xs text-muted-foreground">{device.battery_level}%</span>
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <DevicePairingCard device={device} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {device.guards?.full_name || "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {device.site_location || "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {device.last_seen_at
                        ? formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true })
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailDevice(device)}>
                            <Eye className="mr-2 h-4 w-4" /> View Details
                          </DropdownMenuItem>
                          {isAdmin && (
                            <DropdownMenuItem onClick={() => { setEditDevice(device); setRegisterOpen(true); }}>
                              <Pencil className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <DeviceRegistrationDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        editDevice={editDevice}
      />

      <DeviceDetailSheet
        device={detailDevice}
        open={!!detailDevice}
        onOpenChange={(open) => !open && setDetailDevice(null)}
      />
    </div>
  );
};

export default Devices;
