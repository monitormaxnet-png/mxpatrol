import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useOfflineScanQueue } from "@/hooks/useOfflineScanQueue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Scan, Clock, WifiOff, AlertTriangle, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import ManualScanForm from "@/components/scan/ManualScanForm";

const MAX_MANUAL_SCANS_PER_SHIFT = 3;

type ScanEntry = {
  id: string;
  guard_id: string;
  checkpoint_id: string;
  scanned_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  is_offline_sync: boolean | null;
  is_manual: boolean;
  guards?: { full_name: string; badge_number: string } | null;
  checkpoints?: { name: string } | null;
};

const ScanRecord = () => {
  const { user } = useAuth();
  const { canManage } = useUserRole();
  const queryClient = useQueryClient();
  const { pendingCount, syncQueue, syncing } = useOfflineScanQueue();
  const [selectedGuard, setSelectedGuard] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("company_id").eq("id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: checkpoints = [] } = useQuery({
    queryKey: ["checkpoints"],
    queryFn: async () => {
      const { data, error } = await supabase.from("checkpoints").select("id, name, nfc_tag_id").order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["guards-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guards").select("id, full_name, badge_number").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Count manual scans in the current shift (last 12 hours)
  const { data: manualScanCount = 0 } = useQuery({
    queryKey: ["manual_scan_count", selectedGuard],
    queryFn: async () => {
      const shiftStart = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from("scan_logs")
        .select("id", { count: "exact", head: true })
        .eq("guard_id", selectedGuard)
        .eq("is_manual", true)
        .gte("scanned_at", shiftStart);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!selectedGuard,
  });

  const { data: recentScans = [] } = useQuery({
    queryKey: ["recent_scans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_logs")
        .select("id, guard_id, checkpoint_id, scanned_at, gps_lat, gps_lng, is_offline_sync, is_manual, guards(full_name, badge_number), checkpoints(name)")
        .order("scanned_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as ScanEntry[];
    },
    enabled: !!user,
  });

  const captureGps = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsLoading(false);
        toast.success("Location captured");
      },
      (err) => {
        setGpsLoading(false);
        toast.error(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Record Scan</h2>
        <p className="text-sm text-muted-foreground">Fallback Manual Entry (Restricted)</p>
      </div>

      {/* Offline sync bar */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 border-warning/30 text-warning text-xs">
            {pendingCount} pending sync
          </Badge>
          {isOnline && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => syncQueue().then(() => queryClient.invalidateQueries({ queryKey: ["recent_scans"] }))}
              disabled={syncing}
              className="h-7 text-xs"
            >
              Sync now
            </Button>
          )}
        </div>
      )}

      {/* Gate: "Having trouble scanning NFC?" */}
      {!showManualForm ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-10 text-center">
          <div className="mb-4 rounded-full bg-warning/10 p-4">
            <AlertTriangle className="h-10 w-10 text-warning" />
          </div>
          <h3 className="font-heading text-lg font-bold text-foreground mb-1">Use the NFC Scanner</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs">
            Scans should be recorded via the NFC Scanner for accuracy and security. Manual entry is a monitored fallback.
          </p>
          <Button
            variant="outline"
            onClick={() => setShowManualForm(true)}
            className="gap-2 border-warning/30 text-warning hover:bg-warning/10"
          >
            <ChevronDown className="h-4 w-4" />
            Having trouble scanning NFC?
          </Button>
        </motion.div>
      ) : (
        <AnimatePresence>
          <ManualScanForm
            guards={guards}
            checkpoints={checkpoints}
            selectedGuard={selectedGuard}
            onGuardChange={setSelectedGuard}
            gps={gps}
            gpsLoading={gpsLoading}
            onCaptureGps={captureGps}
            isOnline={isOnline}
            companyId={profile?.company_id ?? null}
            manualScanCount={manualScanCount}
            maxManualScans={MAX_MANUAL_SCANS_PER_SHIFT}
            canBypassLimit={canManage}
          />
        </AnimatePresence>
      )}

      {/* Recent scans */}
      <div>
        <h3 className="mb-3 font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent Scans
        </h3>
        {recentScans.length === 0 ? (
          <div className="glass-card flex flex-col items-center py-10 text-center">
            <Clock className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No recent scans</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentScans.map((scan, idx) => (
              <motion.div
                key={scan.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="glass-card flex items-center gap-3 p-3"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${scan.is_manual ? "bg-warning/10" : "bg-primary/10"}`}>
                  {scan.is_manual ? (
                    <AlertTriangle className="h-4 w-4 text-warning" />
                  ) : (
                    <Scan className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {scan.checkpoints?.name || "Unknown"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {scan.guards?.full_name} • {scan.guards?.badge_number}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">{format(new Date(scan.scanned_at), "HH:mm")}</p>
                  <p className="text-[10px] text-muted-foreground/70">{format(new Date(scan.scanned_at), "MMM d")}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  {scan.is_manual && (
                    <Badge variant="outline" className="text-[9px] border-warning/30 text-warning px-1.5 py-0">Manual</Badge>
                  )}
                  {scan.is_offline_sync && (
                    <WifiOff className="h-3 w-3 text-muted-foreground/50" />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanRecord;
