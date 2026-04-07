import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Power,
  PowerOff,
  Ban,
  RefreshCw,
  Terminal,
  Lock,
  Trash2,
  Smartphone,
  Shield,
  MoreVertical,
  Loader2,
} from "lucide-react";

interface DeviceLifecycleActionsProps {
  device: any;
}

type LifecycleAction = "activate" | "suspend" | "revoke";

const actionConfig: Record<LifecycleAction, { icon: typeof Power; label: string; description: string; variant: "default" | "destructive" }> = {
  activate: { icon: Power, label: "Activate", description: "This will bring the device online and allow it to send data.", variant: "default" },
  suspend: { icon: PowerOff, label: "Suspend", description: "This will temporarily disable the device. It can be reactivated later.", variant: "default" },
  revoke: { icon: Ban, label: "Revoke", description: "This will permanently revoke the device. This action cannot be easily undone.", variant: "destructive" },
};

export default function DeviceLifecycleActions({ device }: DeviceLifecycleActionsProps) {
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(null);

  const mutation = useMutation({
    mutationFn: async (action: string) => {
      const { data, error } = await supabase.functions.invoke("device-lifecycle", {
        body: { device_id: device.id, action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, action) => {
      toast.success(`Device ${action}d successfully`);
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      setConfirmAction(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Action failed");
    },
  });

  const commandMutation = useMutation({
    mutationFn: async (commandType: string) => {
      const { data, error } = await supabase.functions.invoke("device-lifecycle", {
        body: { device_id: device.id, action: "command", command_type: commandType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Command queued (ID: ${data.command_id?.slice(0, 8)}...)`);
    },
    onError: (err: any) => {
      toast.error(err.message || "Command failed");
    },
  });

  const isRevoked = device.pairing_status === "revoked";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <MoreVertical className="h-4 w-4 mr-1" />
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {device.status !== "online" && !isRevoked && (
            <DropdownMenuItem onClick={() => setConfirmAction("activate")}>
              <Power className="mr-2 h-4 w-4 text-success" /> Activate
            </DropdownMenuItem>
          )}
          {device.status === "online" && (
            <DropdownMenuItem onClick={() => setConfirmAction("suspend")}>
              <PowerOff className="mr-2 h-4 w-4 text-warning" /> Suspend
            </DropdownMenuItem>
          )}
          {!isRevoked && (
            <DropdownMenuItem onClick={() => setConfirmAction("revoke")} className="text-destructive">
              <Ban className="mr-2 h-4 w-4" /> Revoke
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => commandMutation.mutate("lock_device")} disabled={isRevoked}>
            <Lock className="mr-2 h-4 w-4" /> Lock Device
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => commandMutation.mutate("set_kiosk_mode")} disabled={isRevoked}>
            <Smartphone className="mr-2 h-4 w-4" /> Kiosk Mode
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction && actionConfig[confirmAction].label} Device?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction && actionConfig[confirmAction].description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && mutation.mutate(confirmAction)}
              className={confirmAction === "revoke" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmAction && actionConfig[confirmAction].label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
