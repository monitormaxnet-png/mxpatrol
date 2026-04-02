import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOfflineScanQueue } from "@/hooks/useOfflineScanQueue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Scan, MapPin, CheckCircle2, Clock, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

type ScanEntry = {
  id: string;
  guard_id: string;
  checkpoint_id: string;
  scanned_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  is_offline_sync: boolean | null;
  guards?: { full_name: string; badge_number: string } | null;
  checkpoints?: { name: string } | null;
};

const ScanRecord = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { queue, enqueue, syncQueue, syncing, pendingCount } = useOfflineScanQueue();
  const [selectedCheckpoint, setSelectedCheckpoint] = useState("");
  const [selectedGuard, setSelectedGuard] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Track online status
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
      const { data, error } = await supabase
        .from("guards")
        .select("id, full_name, badge_number")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: recentScans = [] } = useQuery({
    queryKey: ["recent_scans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_logs")
        .select("*, guards(full_name, badge_number), checkpoints(name)")
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

  const scanMutation = useMutation({
    mutationFn: async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user!.id)
        .single();
      if (!profile?.company_id) throw new Error("No company");

      const scanData = {
        guard_id: selectedGuard,
        checkpoint_id: selectedCheckpoint,
        company_id: profile.company_id,
        scanned_at: new Date().toISOString(),
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
      };

      if (!isOnline) {
        enqueue(scanData);
        return;
      }

      const { error } = await supabase.from("scan_logs").insert({
        ...scanData,
        is_offline_sync: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
      queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 2500);
      setSelectedCheckpoint("");
      setGps(null);
      toast.success(isOnline ? "Scan recorded successfully" : "Scan saved offline — will sync when online");
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedCp = checkpoints.find((c) => c.id === selectedCheckpoint);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Record Scan</h2>
        <p className="text-sm text-muted-foreground">Log NFC checkpoint scans manually</p>
      </div>

      {/* Scan Form Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card relative overflow-hidden p-6"
      >
        <AnimatePresence>
          {scanSuccess && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/95 backdrop-blur"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 12 }}
              >
                <CheckCircle2 className="h-16 w-16 text-success" />
              </motion.div>
              <p className="mt-3 font-heading text-lg font-bold text-success">Scan Recorded!</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-5">
          {/* Connection status */}
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Badge variant="default" className="gap-1.5 bg-success/20 text-success border-success/30">
                <Wifi className="h-3 w-3" /> Online
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1.5">
                <WifiOff className="h-3 w-3" /> Offline — scans queued locally
              </Badge>
            )}
            {pendingCount > 0 && (
              <Badge variant="outline" className="gap-1.5 border-warning/30 text-warning">
                {pendingCount} pending
              </Badge>
            )}
            {pendingCount > 0 && isOnline && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { syncQueue().then(() => { queryClient.invalidateQueries({ queryKey: ["recent_scans"] }); }); }}
                disabled={syncing}
                className="h-7 gap-1 px-2 text-xs"
              >
                <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
                Sync now
              </Button>
            )}
          </div>

          {/* Guard selection */}
          <div className="space-y-2">
            <Label>Guard</Label>
            <Select value={selectedGuard} onValueChange={setSelectedGuard}>
              <SelectTrigger>
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

          {/* Checkpoint selection */}
          <div className="space-y-2">
            <Label>Checkpoint</Label>
            <Select value={selectedCheckpoint} onValueChange={setSelectedCheckpoint}>
              <SelectTrigger>
                <SelectValue placeholder="Select or scan checkpoint" />
              </SelectTrigger>
              <SelectContent>
                {checkpoints.map((cp) => (
                  <SelectItem key={cp.id} value={cp.id}>
                    {cp.name} — {cp.nfc_tag_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCp && (
              <p className="text-xs text-muted-foreground">
                NFC Tag: <span className="font-mono text-primary">{selectedCp.nfc_tag_id}</span>
              </p>
            )}
          </div>

          {/* GPS Capture */}
          <div className="space-y-2">
            <Label>GPS Location</Label>
            <Button
              type="button"
              variant="outline"
              onClick={captureGps}
              disabled={gpsLoading}
              className="w-full gap-2"
            >
              <MapPin className="h-4 w-4" />
              {gpsLoading ? "Capturing..." : gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : "Capture Location"}
            </Button>
          </div>

          {/* Submit */}
          <Button
            onClick={() => scanMutation.mutate()}
            disabled={!selectedGuard || !selectedCheckpoint || scanMutation.isPending}
            className="w-full gap-2 text-base py-6"
            size="lg"
          >
            <Scan className="h-5 w-5" />
            {scanMutation.isPending ? "Recording..." : "Record Scan"}
          </Button>
        </div>
      </motion.div>

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
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Scan className="h-4 w-4 text-primary" />
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
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(scan.scanned_at), "HH:mm")}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    {format(new Date(scan.scanned_at), "MMM d")}
                  </p>
                </div>
                {scan.is_offline_sync && (
                  <WifiOff className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanRecord;
