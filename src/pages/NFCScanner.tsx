import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useNfcReader } from "@/hooks/useNfcReader";
import { useNfcScanProcessor, type ScanValidationResult } from "@/hooks/useNfcScanProcessor";
import { useOfflineScanQueue } from "@/hooks/useOfflineScanQueue";
import ScannerRing from "@/components/scanner/ScannerRing";
import ScannerControls from "@/components/scanner/ScannerControls";
import ScanLog, { type ScanLogEntry } from "@/components/scanner/ScanLog";
import ManualScanForm from "@/components/scan/ManualScanForm";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, AlertTriangle } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";

const NFCScanner = () => {
  const { user } = useAuth();
  const { canManage } = useUserRole();
  const queryClient = useQueryClient();
  const { syncQueue, syncing, pendingCount } = useOfflineScanQueue();

  const [selectedGuard, setSelectedGuard] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [sessionLog, setSessionLog] = useState<ScanLogEntry[]>([]);
  const [scannerStatus, setScannerStatus] = useState<NfcStatus>("idle");
  const [lastCheckpoint, setLastCheckpoint] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showManualFallback, setShowManualFallback] = useState(false);

  // Online/offline tracking
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Company ID
  const { data: profile } = useQuery({
    queryKey: ["profile-company", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("company_id").eq("id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  // Checkpoints
  const { data: checkpoints = [] } = useQuery({
    queryKey: ["checkpoints"],
    queryFn: async () => {
      const { data, error } = await supabase.from("checkpoints").select("id, name, nfc_tag_id, patrol_id").order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Guards
  const { data: guards = [] } = useQuery({
    queryKey: ["guards-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guards").select("id, full_name, badge_number").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Scan processor
  const { processScan } = useNfcScanProcessor({
    checkpoints,
    selectedGuardId: selectedGuard,
    companyId: profile?.company_id ?? null,
    isOnline,
    onSuccess: (result) => {
      setScannerStatus("success");
      setLastCheckpoint(result.checkpoint?.name ?? null);
      setLastError(null);
      addToLog(result, true);
      queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
      queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
      setTimeout(() => setScannerStatus(nfcReader.supported ? "scanning" : "idle"), 2500);
    },
    onFailure: (result) => {
      setScannerStatus("error");
      setLastCheckpoint(null);
      setLastError(result.reason ?? "Unknown error");
      addToLog(result, false);
      setTimeout(() => setScannerStatus(nfcReader.supported ? "scanning" : "idle"), 2500);
    },
  });

  const addToLog = (result: ScanValidationResult, valid: boolean) => {
    setSessionLog((prev) => [
      {
        id: crypto.randomUUID(),
        checkpointName: result.checkpoint?.name ?? "Unknown Tag",
        timestamp: new Date().toISOString(),
        valid,
        offline: !isOnline,
      },
      ...prev,
    ].slice(0, 50));
  };

  // NFC Reader
  const nfcReader = useNfcReader({
    onScan: async ({ serialNumber }) => {
      if (!selectedGuard) {
        setScannerStatus("error");
        setLastError("Select a guard before scanning");
        setTimeout(() => setScannerStatus("scanning"), 2000);
        return;
      }
      await processScan(serialNumber, gps);
    },
    debounceMs: 3000,
  });

  // Sync NFC reader status with scanner status
  useEffect(() => {
    if (nfcReader.status === "scanning" && scannerStatus === "idle") {
      setScannerStatus("scanning");
    }
    if (nfcReader.status === "unsupported" || nfcReader.status === "disabled") {
      setScannerStatus(nfcReader.status);
      setLastError(nfcReader.errorMessage);
    }
  }, [nfcReader.status]);

  const captureGps = () => {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsLoading(false); },
      (err) => { setGpsLoading(false); toast.error(`GPS error: ${err.message}`); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleStartScan = () => {
    if (!selectedGuard) { toast.error("Select a guard first"); return; }
    captureGps();
    nfcReader.startScanning();
  };

  // Manual scan count for rate limiting
  const { data: manualScanCount = 0 } = useQuery({
    queryKey: ["manual_scan_count", selectedGuard],
    queryFn: async () => {
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("scan_logs")
        .select("*", { count: "exact", head: true })
        .eq("guard_id", selectedGuard)
        .eq("is_manual", true)
        .gte("scanned_at", twelveHoursAgo);
      return count ?? 0;
    },
    enabled: !!selectedGuard,
  });

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] lg:min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">NFC Scanner</h2>
          <p className="text-xs text-muted-foreground">Tap NFC tags to verify checkpoints</p>
        </div>
      </div>

      {/* Scanner Area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <ScannerRing
            status={scannerStatus}
            checkpointName={lastCheckpoint}
            errorReason={lastError}
            onClick={scannerStatus === "idle" ? handleStartScan : undefined}
          />
        </motion.div>

        {/* Action buttons */}
        <div className="mt-6 w-full max-w-xs space-y-3">
          {scannerStatus === "idle" && (
            <Button
              onClick={handleStartScan}
              disabled={!selectedGuard}
              className="w-full gap-2 py-5 text-base"
              size="lg"
            >
              <ScanLine className="h-5 w-5" />
              Start NFC Scanning
            </Button>
          )}
          {scannerStatus === "scanning" && (
            <Button
              onClick={nfcReader.stopScanning}
              variant="outline"
              className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              Stop Scanning
            </Button>
          )}
        </div>
      </div>

      {/* Manual Fallback Toggle */}
      <div className="px-4 mb-2">
        {!showManualFallback ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowManualFallback(true)}
            className="w-full gap-1.5 text-xs h-8 text-muted-foreground hover:text-warning"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Having trouble scanning NFC?
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowManualFallback(false)}
            className="w-full gap-1.5 text-xs h-8 text-muted-foreground"
          >
            Hide manual fallback
          </Button>
        )}
      </div>

      {/* Manual Scan Form (restricted fallback) */}
      <AnimatePresence>
        {showManualFallback && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 mb-4 overflow-hidden"
          >
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
              maxManualScans={3}
              canBypassLimit={canManage}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom panel */}
      <div className="glass-card mx-4 mb-4 p-4 space-y-4 rounded-xl">
        <ScannerControls
          guards={guards}
          selectedGuard={selectedGuard}
          onGuardChange={setSelectedGuard}
          gps={gps}
          gpsLoading={gpsLoading}
          onCaptureGps={captureGps}
          isOnline={isOnline}
          pendingCount={pendingCount}
          syncing={syncing}
          onSync={() => syncQueue().then(() => queryClient.invalidateQueries({ queryKey: ["recent_scans"] }))}
        />
        <ScanLog entries={sessionLog} />
      </div>
    </div>
  );
};

export default NFCScanner;
