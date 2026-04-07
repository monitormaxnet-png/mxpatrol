import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Activity } from "lucide-react";

const actionLabels: Record<string, { label: string; color: string }> = {
  enrolled: { label: "Enrolled", color: "bg-primary text-primary-foreground" },
  activated: { label: "Activated", color: "bg-success text-success-foreground" },
  suspended: { label: "Suspended", color: "bg-warning text-warning-foreground" },
  revoked: { label: "Revoked", color: "bg-destructive text-destructive-foreground" },
  replaced: { label: "Replaced", color: "bg-muted text-muted-foreground" },
  heartbeat: { label: "Heartbeat", color: "bg-accent text-accent-foreground" },
  command_sent: { label: "Command Sent", color: "bg-primary/80 text-primary-foreground" },
  command_executed: { label: "Command Done", color: "bg-success/80 text-success-foreground" },
};

interface Props {
  deviceId: string;
}

export default function DeviceActivityLog({ deviceId }: Props) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["device-activity-logs", deviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_activity_logs")
        .select("*")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!deviceId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
        <Activity className="h-8 w-8" />
        <p className="text-sm">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-3 pr-4">
        {logs.map((log: any) => {
          const config = actionLabels[log.action] || { label: log.action, color: "bg-muted text-muted-foreground" };
          return (
            <div key={log.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Badge className={config.color}>{config.label}</Badge>
              <div className="flex-1 min-w-0">
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                  <p className="text-xs text-muted-foreground truncate">
                    {JSON.stringify(log.metadata).slice(0, 100)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
