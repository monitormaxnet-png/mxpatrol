import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, CheckCircle2, XCircle, Clock, Send,
  Lock, Trash, Smartphone, Settings, Download, Upload,
} from "lucide-react";

const statusConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: "Pending", icon: Clock, color: "bg-warning/10 text-warning border-warning/30" },
  sent: { label: "Sent", icon: Send, color: "bg-primary/10 text-primary border-primary/30" },
  executed: { label: "Executed", icon: CheckCircle2, color: "bg-success/10 text-success border-success/30" },
  failed: { label: "Failed", icon: XCircle, color: "bg-destructive/10 text-destructive border-destructive/30" },
};

const typeIcons: Record<string, typeof Lock> = {
  lock_device: Lock,
  wipe_device: Trash,
  set_kiosk_mode: Smartphone,
  update_policy: Settings,
  install_app: Download,
  uninstall_app: Upload,
};

const typeLabels: Record<string, string> = {
  lock_device: "Lock",
  wipe_device: "Wipe",
  set_kiosk_mode: "Kiosk",
  update_policy: "Policy",
  install_app: "Install",
  uninstall_app: "Uninstall",
};

export default function CommandTracker() {
  const { data: commands = [], isLoading } = useDeviceCommands();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commands.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <Send className="h-8 w-8" />
        <p className="text-sm">No commands issued yet</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Command</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Issued</TableHead>
            <TableHead className="hidden lg:table-cell">Executed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {commands.map((cmd: any) => {
            const status = statusConfig[cmd.status] || statusConfig.pending;
            const StatusIcon = status.icon;
            const TypeIcon = typeIcons[cmd.command_type] || Settings;

            return (
              <TableRow key={cmd.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <TypeIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {typeLabels[cmd.command_type] || cmd.command_type}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {cmd.devices?.device_name || cmd.device_id?.slice(0, 8)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={status.color}>
                    <StatusIcon className="mr-1 h-3 w-3" />
                    {status.label}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(cmd.issued_at), { addSuffix: true })}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {cmd.executed_at
                    ? formatDistanceToNow(new Date(cmd.executed_at), { addSuffix: true })
                    : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
