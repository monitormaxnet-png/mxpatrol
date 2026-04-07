import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDevices } from "@/hooks/useDashboardData";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Lock, Smartphone, Trash, Download, Upload, Settings } from "lucide-react";

const commandTypes = [
  { value: "lock_device", label: "Lock Device", icon: Lock, description: "Lock the device screen immediately" },
  { value: "wipe_device", label: "Wipe Device", icon: Trash, description: "Factory reset the device (destructive)" },
  { value: "set_kiosk_mode", label: "Set Kiosk Mode", icon: Smartphone, description: "Lock device to a single app" },
  { value: "update_policy", label: "Update Policy", icon: Settings, description: "Push updated policy to device" },
  { value: "install_app", label: "Install App", icon: Download, description: "Silently install an application" },
  { value: "uninstall_app", label: "Uninstall App", icon: Upload, description: "Remove an application" },
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedDeviceId?: string;
}

export default function BulkCommandDialog({ open, onOpenChange, preselectedDeviceId }: Props) {
  const { data: devices = [] } = useDevices();
  const queryClient = useQueryClient();
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(
    preselectedDeviceId ? new Set([preselectedDeviceId]) : new Set()
  );
  const [commandType, setCommandType] = useState("");
  const [payload, setPayload] = useState("");

  const toggleDevice = (id: string) => {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedDevices.size === devices.length) {
      setSelectedDevices(new Set());
    } else {
      setSelectedDevices(new Set(devices.map((d: any) => d.id)));
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const deviceIds = Array.from(selectedDevices);
      const results = await Promise.allSettled(
        deviceIds.map((deviceId) =>
          supabase.functions.invoke("device-lifecycle", {
            body: {
              device_id: deviceId,
              action: "command",
              command_type: commandType,
              command_payload: payload ? JSON.parse(payload) : {},
            },
          })
        )
      );

      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.filter((r) => r.status === "fulfilled").length;

      if (failed > 0) {
        toast.warning(`${succeeded} commands sent, ${failed} failed`);
      }

      return { succeeded, failed };
    },
    onSuccess: ({ succeeded }) => {
      toast.success(`${succeeded} command(s) queued successfully`);
      queryClient.invalidateQueries({ queryKey: ["device-commands"] });
      onOpenChange(false);
      setSelectedDevices(new Set());
      setCommandType("");
      setPayload("");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to send commands");
    },
  });

  const selectedCommand = commandTypes.find((c) => c.value === commandType);
  const isDestructive = commandType === "wipe_device";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Issue Command
          </DialogTitle>
          <DialogDescription>
            Send a remote command to one or more devices
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Command Type */}
          <div className="space-y-2">
            <Label>Command Type</Label>
            <Select value={commandType} onValueChange={setCommandType}>
              <SelectTrigger>
                <SelectValue placeholder="Select command..." />
              </SelectTrigger>
              <SelectContent>
                {commandTypes.map((cmd) => {
                  const Icon = cmd.icon;
                  return (
                    <SelectItem key={cmd.value} value={cmd.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-3 w-3" />
                        {cmd.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedCommand && (
              <p className="text-xs text-muted-foreground">{selectedCommand.description}</p>
            )}
          </div>

          {/* Payload (for install/uninstall/kiosk/policy) */}
          {commandType && !["lock_device", "wipe_device"].includes(commandType) && (
            <div className="space-y-2">
              <Label>Payload (JSON)</Label>
              <Input
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder='e.g. {"package": "com.example.app"}'
                className="font-mono text-xs"
              />
            </div>
          )}

          {/* Device Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Target Devices ({selectedDevices.size} selected)</Label>
              <Button variant="ghost" size="sm" onClick={selectAll}>
                {selectedDevices.size === devices.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <ScrollArea className="h-[200px] rounded-lg border border-border">
              <div className="space-y-1 p-2">
                {devices.map((device: any) => {
                  const isOnline = device.status === "online";
                  return (
                    <label
                      key={device.id}
                      className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedDevices.has(device.id)}
                        onCheckedChange={() => toggleDevice(device.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {device.device_name || device.device_identifier}
                        </p>
                        <p className="text-xs text-muted-foreground">{device.device_identifier}</p>
                      </div>
                      <Badge
                        variant={isOnline ? "default" : "secondary"}
                        className={`text-[10px] ${isOnline ? "bg-success text-success-foreground" : ""}`}
                      >
                        {isOnline ? "Online" : "Offline"}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {isDestructive && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
              <p className="text-xs text-destructive font-medium">
                ⚠️ Wipe Device is a destructive action. This will factory reset the selected device(s) and cannot be undone.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || selectedDevices.size === 0 || !commandType}
            variant={isDestructive ? "destructive" : "default"}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send to {selectedDevices.size} Device{selectedDevices.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
