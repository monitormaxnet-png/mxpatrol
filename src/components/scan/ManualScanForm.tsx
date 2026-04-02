import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Scan, MapPin, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MANUAL_REASONS = [
  { value: "nfc_failure", label: "NFC reader failure" },
  { value: "tag_missing", label: "NFC tag missing / damaged" },
  { value: "device_issue", label: "Device hardware issue" },
] as const;

interface ManualScanFormProps {
  guards: Array<{ id: string; full_name: string; badge_number: string }>;
  checkpoints: Array<{ id: string; name: string; nfc_tag_id: string }>;
  selectedGuard: string;
  onGuardChange: (id: string) => void;
  gps: { lat: number; lng: number } | null;
  gpsLoading: boolean;
  onCaptureGps: () => void;
  isOnline: boolean;
  companyId: string | null;
  manualScanCount: number;
  maxManualScans: number;
  canBypassLimit: boolean;
}

const ManualScanForm = ({
  guards,
  checkpoints,
  selectedGuard,
  onGuardChange,
  gps,
  gpsLoading,
  onCaptureGps,
  isOnline,
  companyId,
  manualScanCount,
  maxManualScans,
  canBypassLimit,
}: ManualScanFormProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedCheckpoint, setSelectedCheckpoint] = useState("");
  const [reason, setReason] = useState("");
  const [scanSuccess, setScanSuccess] = useState(false);

  const limitReached = !canBypassLimit && manualScanCount >= maxManualScans;

  const scanMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No company configured");
      if (!gps) throw new Error("GPS location is required for manual scans");
      if (!reason) throw new Error("A reason is required for manual scans");

      const scanData = {
        guard_id: selectedGuard,
        checkpoint_id: selectedCheckpoint,
        company_id: companyId,
        scanned_at: new Date().toISOString(),
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        is_offline_sync: !isOnline,
        is_manual: true,
        manual_scan_reason: reason,
      };

      const { error } = await supabase.from("scan_logs").insert(scanData);
      if (error) throw error;

      // Trigger supervisor alert
      const guard = guards.find((g) => g.id === selectedGuard);
      const checkpoint = checkpoints.find((c) => c.id === selectedCheckpoint);
      await supabase.from("alerts").insert({
        company_id: companyId,
        type: "anomaly" as const,
        severity: "medium" as const,
        guard_id: selectedGuard,
        message: `Manual scan entry by ${guard?.full_name ?? "Unknown"} at ${checkpoint?.name ?? "Unknown"} — Reason: ${MANUAL_REASONS.find((r) => r.value === reason)?.label ?? reason}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
      queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
      queryClient.invalidateQueries({ queryKey: ["manual_scan_count"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 2500);
      setSelectedCheckpoint("");
      setReason("");
      toast.success("Manual scan recorded — supervisor notified");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit =
    !!selectedGuard &&
    !!selectedCheckpoint &&
    !!gps &&
    !!reason &&
    !scanMutation.isPending &&
    !limitReached;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card relative overflow-hidden p-5 border border-warning/20"
    >
      <AnimatePresence>
        {scanSuccess && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/95 backdrop-blur"
          >
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", damping: 12 }}>
              <CheckCircle2 className="h-14 w-14 text-success" />
            </motion.div>
            <p className="mt-3 font-heading text-lg font-bold text-success">Manual Scan Recorded</p>
            <p className="text-xs text-muted-foreground mt-1">Supervisor has been notified</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audit Warning */}
      <div className="mb-4 flex items-start gap-2 rounded-lg bg-warning/10 border border-warning/20 p-3">
        <ShieldAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-warning">Manual entries are monitored and audited</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            All manual scans require GPS verification, a valid reason, and trigger supervisor notifications.
          </p>
        </div>
      </div>

      {/* Usage counter */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Manual scans this shift: <span className={`font-bold ${limitReached ? "text-destructive" : "text-foreground"}`}>{manualScanCount}/{maxManualScans}</span>
        </p>
        {canBypassLimit && (
          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Supervisor override</Badge>
        )}
      </div>

      {limitReached && (
        <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
          <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Manual scan limit reached — contact your supervisor
          </p>
        </div>
      )}

      <div className="space-y-4">
        {/* Guard */}
        <div className="space-y-1.5">
          <Label className="text-xs">Guard</Label>
          <Select value={selectedGuard} onValueChange={onGuardChange}>
            <SelectTrigger className="h-10 bg-card/60 border-border/50">
              <SelectValue placeholder="Select guard on duty" />
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

        {/* Checkpoint */}
        <div className="space-y-1.5">
          <Label className="text-xs">Checkpoint</Label>
          <Select value={selectedCheckpoint} onValueChange={setSelectedCheckpoint}>
            <SelectTrigger className="h-10 bg-card/60 border-border/50">
              <SelectValue placeholder="Select checkpoint" />
            </SelectTrigger>
            <SelectContent>
              {checkpoints.map((cp) => (
                <SelectItem key={cp.id} value={cp.id}>
                  {cp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Reason (required) */}
        <div className="space-y-1.5">
          <Label className="text-xs">Reason for Manual Entry <span className="text-destructive">*</span></Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-10 bg-card/60 border-border/50">
              <SelectValue placeholder="Select reason" />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* GPS (required) */}
        <div className="space-y-1.5">
          <Label className="text-xs">GPS Location <span className="text-destructive">*</span></Label>
          <Button
            type="button"
            variant={gps ? "default" : "outline"}
            onClick={onCaptureGps}
            disabled={gpsLoading}
            className={`w-full gap-2 h-10 text-xs ${gps ? "bg-success/20 text-success border-success/30 hover:bg-success/30" : ""}`}
            size="sm"
          >
            <MapPin className="h-3.5 w-3.5" />
            {gpsLoading ? "Capturing..." : gps ? `✓ ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : "Capture GPS (Required)"}
          </Button>
        </div>

        {/* Submit */}
        <Button
          onClick={() => scanMutation.mutate()}
          disabled={!canSubmit}
          className="w-full gap-2 py-5"
          variant="destructive"
        >
          <Scan className="h-4 w-4" />
          {scanMutation.isPending ? "Recording..." : "Submit Manual Scan"}
        </Button>
      </div>
    </motion.div>
  );
};

export default ManualScanForm;
