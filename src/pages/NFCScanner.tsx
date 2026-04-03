import { useState, useEffect, useCallback, useRef } from "react";
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
import FaceVerification, { type FaceVerifyResult } from "@/components/scanner/FaceVerification";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, AlertTriangle, ShieldCheck } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
  const bgMapContainerRef = useRef<HTMLDivElement>(null);
  const bgMapRef = useRef<L.Map | null>(null);

  // Face verification state
  const [pendingFaceScan, setPendingFaceScan] = useState<{
    result: ScanValidationResult;
    scanData: any;
  } | null>(null);

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
      const { data, error } = await supabase.from("checkpoints").select("id, name, nfc_tag_id, patrol_id, location_lat, location_lng").order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Background map initialization
  useEffect(() => {
    if (!bgMapContainerRef.current || bgMapRef.current) return;

    const map = L.map(bgMapContainerRef.current, {
      center: [0, 0],
      zoom: 2,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "",
    }).addTo(map);

    bgMapRef.current = map;

    return () => {
      map.remove();
      bgMapRef.current = null;
    };
  }, []);

  // Fit background map to checkpoints and add markers
  useEffect(() => {
    const map = bgMapRef.current;
    if (!map) return;

    const withCoords = checkpoints.filter(
      (cp: any) => cp.location_lat != null && cp.location_lng != null
    );

    if (withCoords.length > 0) {
      const bounds = L.latLngBounds(
        withCoords.map((cp: any) => [cp.location_lat!, cp.location_lng!])
      );
      map.fitBounds(bounds.pad(1.5), { animate: false, maxZoom: 10 });

      withCoords.forEach((cp: any) => {
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:10px;height:10px;transform:rotate(45deg);background:hsl(188,95%,50%);border:2px solid rgba(255,255,255,0.6);box-shadow:0 0 12px hsl(188,95%,50%,0.5);opacity:0.7;"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        L.marker([cp.location_lat!, cp.location_lng!], { icon, interactive: false }).addTo(map);
      });
    }
  }, [checkpoints]);

  // Patrols (for verification_level)
  const { data: patrols = [] } = useQuery({
    queryKey: ["patrols-verification"],
    queryFn: async () => {
      const { data, error } = await supabase.from("patrols").select("id, verification_level");
      if (error) throw error;
      return data as Array<{ id: string; verification_level: string }>;
    },
    enabled: !!user,
  });

  // Guards
  const { data: guards = [] } = useQuery({
    queryKey: ["guards-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guards").select("id, full_name, badge_number, photo_url").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const selectedGuardData = guards.find((g) => g.id === selectedGuard);

  // Scan processor
  const { processScan } = useNfcScanProcessor({
    checkpoints,
    patrols,
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
    onFaceVerificationRequired: (result, scanData) => {
      // Pause scanning, show face verification
      setScannerStatus("idle");
      setPendingFaceScan({ result, scanData });
      toast.info("🔐 Face verification required for this patrol");
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

  // Handle face verification result
  const handleFaceResult = useCallback(async (faceResult: FaceVerifyResult) => {
    if (!pendingFaceScan) return;

    if (faceResult.verified) {
      // Complete the scan with face data
      const { scanData } = pendingFaceScan;
      try {
        const { error } = await supabase.from("scan_logs").insert({
          ...scanData,
          is_offline_sync: false,
          face_verified: true,
          face_confidence: faceResult.confidence,
        });
        if (error) throw error;

        setScannerStatus("success");
        setLastCheckpoint(pendingFaceScan.result.checkpoint?.name ?? null);
        addToLog(pendingFaceScan.result, true);
        queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
        toast.success("✅ Triple-verified: NFC + GPS + Face ID");
      } catch {
        toast.error("Failed to save verified scan");
      }
    } else {
      // Face verification failed — flag as alert
      setScannerStatus("error");
      setLastError("Face verification failed — identity mismatch");
      addToLog(pendingFaceScan.result, false);

      // Create security alert
      if (profile?.company_id) {
        await supabase.from("alerts").insert({
          company_id: profile.company_id,
          type: "anomaly" as const,
          severity: "high" as const,
          guard_id: selectedGuard || null,
          message: `Face verification FAILED at checkpoint "${pendingFaceScan.result.checkpoint?.name}". Confidence: ${Math.round(faceResult.confidence * 100)}%. Possible identity mismatch.`,
        });
      }
      toast.error("⚠️ Face mismatch — security alert generated");
    }

    setPendingFaceScan(null);
    setTimeout(() => setScannerStatus(nfcReader.supported ? "scanning" : "idle"), 3000);
  }, [pendingFaceScan, selectedGuard, profile?.company_id, queryClient]);

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

  // Check if any assigned patrol has enhanced verification
  const hasEnhancedPatrol = patrols.some((p) => p.verification_level === "enhanced");

  return (
    <div className="relative flex flex-col min-h-[calc(100vh-3.5rem)] lg:min-h-[calc(100vh-4rem)] overflow-hidden">
      {/* Live map background */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div ref={bgMapContainerRef} className="absolute inset-0" style={{ opacity: 0.85 }} />
        {/* Soft edge vignette only */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 50% 40%, transparent 40%, hsl(222 47% 4% / 0.4) 90%),
              linear-gradient(to bottom, hsl(222 47% 4% / 0.15) 0%, transparent 20%, transparent 80%, hsl(222 47% 4% / 0.3) 100%)
            `,
          }}
        />
      </div>

      {/* Header */}
      <div className="relative z-10 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-xl font-bold text-foreground">NFC Scanner</h2>
            <p className="text-xs text-muted-foreground">Tap NFC tags to verify checkpoints</p>
          </div>
          {hasEnhancedPatrol && (
            <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Multi-Factor</span>
            </div>
          )}
        </div>
      </div>

      {/* Face Verification Overlay (z-10) */}
      <AnimatePresence>
        {pendingFaceScan && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative z-10 mx-4 mb-4"
          >
            <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-bold text-foreground">Face Verification Required</p>
                  <p className="text-xs text-muted-foreground">
                    Checkpoint: {pendingFaceScan.result.checkpoint?.name} — NFC ✓ GPS ✓ Face ID pending
                  </p>
                </div>
              </div>
              <FaceVerification
                guardPhotoUrl={selectedGuardData?.photo_url ?? null}
                onResult={handleFaceResult}
              />
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => {
                  setPendingFaceScan(null);
                  setScannerStatus(nfcReader.supported ? "scanning" : "idle");
                  toast.warning("Face verification skipped — scan not recorded");
                }}
              >
                Cancel Verification
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scanner Area */}
      {!pendingFaceScan && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-6">
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
      )}

      {/* Manual Fallback Toggle */}
      <div className="relative z-10 px-4 mb-2">
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
            className="relative z-10 px-4 mb-4 overflow-hidden"
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
      <div className="relative z-10 glass-card mx-4 mb-4 p-4 space-y-4 rounded-xl">
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
