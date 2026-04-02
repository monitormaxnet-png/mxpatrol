import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, RefreshCw, Check, Clock, Loader2 } from "lucide-react";

interface Props {
  device: any;
}

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function DevicePairingCard({ device }: Props) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const isExpired = device.pairing_expires_at && new Date(device.pairing_expires_at) < new Date();
  const isPaired = device.pairing_status === "paired";
  const status = isPaired ? "paired" : isExpired ? "expired" : device.pairing_status;

  const regenerate = useMutation({
    mutationFn: async () => {
      const code = generatePairingCode();
      const { error } = await supabase
        .from("devices")
        .update({
          pairing_code: code,
          pairing_status: "pending",
          pairing_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        .eq("id", device.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("New pairing code generated");
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  const copyCode = () => {
    if (device.pairing_code) {
      navigator.clipboard.writeText(device.pairing_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const statusColor: Record<string, string> = {
    paired: "bg-success/10 text-success border-success/20",
    pending: "bg-warning/10 text-warning border-warning/20",
    expired: "bg-destructive/10 text-destructive border-destructive/20",
    unpaired: "bg-muted text-muted-foreground",
  };

  return (
    <div className="flex items-center gap-3">
      <Badge variant="outline" className={statusColor[status] || statusColor.unpaired}>
        {status === "paired" && <Check className="mr-1 h-3 w-3" />}
        {status === "pending" && <Clock className="mr-1 h-3 w-3" />}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>

      {!isPaired && device.pairing_code && !isExpired && (
        <button
          onClick={copyCode}
          className="flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-xs text-foreground hover:bg-muted/80"
        >
          {device.pairing_code}
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      )}

      {!isPaired && (
        <Button size="sm" variant="ghost" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
          {regenerate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      )}
    </div>
  );
}
