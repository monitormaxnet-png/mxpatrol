import { useState } from "react";
import { Bell, AlertTriangle, Clock, ShieldAlert, Radio, Check, CheckCheck, ScanFace } from "lucide-react";
import { useAlerts } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const alertIcons: Record<string, typeof AlertTriangle> = {
  missed_checkpoint: Clock,
  late_patrol: Clock,
  panic_button: ShieldAlert,
  device_offline: Radio,
  anomaly: AlertTriangle,
};

const severityColors: Record<string, string> = {
  critical: "text-destructive bg-destructive/10",
  high: "text-destructive bg-destructive/10",
  medium: "text-warning bg-warning/10",
  low: "text-muted-foreground bg-muted",
};

const NotificationCenter = () => {
  const { data: alerts = [] } = useAlerts();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const unreadCount = alerts.filter((a: any) => !a.is_read).length;

  const markAsRead = async (alertId: string) => {
    await supabase.from("alerts").update({ is_read: true }).eq("id", alertId);
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
  };

  const markAllAsRead = async () => {
    const unreadIds = alerts.filter((a: any) => !a.is_read).map((a: any) => a.id);
    if (unreadIds.length === 0) return;
    for (const id of unreadIds) {
      await supabase.from("alerts").update({ is_read: true }).eq("id", id);
    }
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={markAllAsRead}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.slice(0, 15).map((alert: any) => {
                const isFaceAlert = alert.message?.toLowerCase().includes("face verification");
                const Icon = isFaceAlert ? ScanFace : (alertIcons[alert.type] || AlertTriangle);
                const colors = isFaceAlert ? "text-destructive bg-destructive/10" : (severityColors[alert.severity] || severityColors.low);
                return (
                  <div
                    key={alert.id}
                    className={`flex gap-3 px-4 py-3 transition-colors ${
                      !alert.is_read ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-tight ${!alert.is_read ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {alert.message}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                        </span>
                        {alert.guards?.full_name && (
                          <span className="text-[10px] text-muted-foreground">
                            • {alert.guards.full_name}
                          </span>
                        )}
                      </div>
                    </div>
                    {!alert.is_read && (
                      <button
                        onClick={() => markAsRead(alert.id)}
                        className="shrink-0 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Mark as read"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationCenter;
