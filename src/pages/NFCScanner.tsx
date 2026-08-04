import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useNfcReader } from "@/hooks/useNfcReader";
import { useNfcScanProcessor, type ScanValidationResult } from "@/hooks/useNfcScanProcessor";
import { useOfflineScanQueue } from "@/hooks/useOfflineScanQueue";
import { useDeviceBattery } from "@/hooks/useDeviceBattery";
import ScannerRing, { type ScannerUiState } from "@/components/scanner/ScannerRing";
import type { ScanLogEntry } from "@/components/scanner/ScanLog";
import type { FaceVerifyResult } from "@/components/scanner/FaceVerification";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";
import { ensureLocationPermission, getCachedDeviceLocation, getDeviceLocation } from "@/lib/deviceGeolocation";
import { updatePatrolDevicePresence } from "@/lib/devicePresence";
import { backfillNfcScanGps } from "@/lib/nfcWorkflow";
import { getLocalDeviceIdentifier, resolveDeviceCompany } from "@/lib/deviceCompany";
import { batteryMetadata } from "@/lib/deviceBattery";
import { playFeedbackSound } from "@/lib/feedbackSound";
import HardwareSosListener from "@/components/devices/HardwareSosListener";
import TTechMxPatrolLogo from "@/components/branding/TTechMxPatrolLogo";

const FaceVerification = lazy(() => import("@/components/scanner/FaceVerification"));

type IdleCallbackWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

type ScanLogInsert = Database["public"]["Tables"]["scan_logs"]["Insert"];
type FaceScanData = ScanLogInsert & { guard_name?: string | null };

const scheduleLowPriority = (work: () => void) => {
  if (typeof window === "undefined") {
    work();
    return;
  }

  const requestIdleCallback = (window as IdleCallbackWindow).requestIdleCallback;

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(work, { timeout: 1500 });
    return;
  }

  window.setTimeout(work, 0);
};

type ScanGps = { lat: number; lng: number; accuracy?: number | null } | null;

const NFCScanner = () => {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { syncQueue, syncing, pendingCount } = useOfflineScanQueue();

  const [gps, setGps] = useState<ScanGps>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "capturing" | "available" | "pending" | "unavailable">("idle");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [sessionLog, setSessionLog] = useState<ScanLogEntry[]>([]);
  const [scannerStatus, setScannerStatus] = useState<ScannerUiState>("initializing");
  const [lastCheckpoint, setLastCheckpoint] = useState<string | null>(null);
  const [lastTagUid, setLastTagUid] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const { battery } = useDeviceBattery();
  const scanDeviceMetadata = useMemo(() => batteryMetadata(battery), [battery]);

  // Face verification state
  const [pendingFaceScan, setPendingFaceScan] = useState<{
    result: ScanValidationResult;
    scanData: FaceScanData;
  } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncVideoPlayback = () => {
      if (document.visibilityState === "visible") {
        void video.play().catch(() => undefined);
        return;
      }

      video.pause();
    };

    syncVideoPlayback();
    document.addEventListener("visibilitychange", syncVideoPlayback);
    return () => document.removeEventListener("visibilitychange", syncVideoPlayback);
  }, []);
  // Online/offline tracking
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const localDeviceIdentifier = getLocalDeviceIdentifier();
  const { data: deviceCompany, isLoading: deviceCompanyLoading, error: deviceCompanyError } = useQuery({
    queryKey: ["device-company", localDeviceIdentifier],
    queryFn: resolveDeviceCompany,
    retry: false,
  });
  const devicePaired = deviceCompany?.pairingStatus === "paired";
  const companyId = devicePaired ? deviceCompany.companyId : null;

  useEffect(() => {
    console.info(`[NFCScanner] device company ${JSON.stringify({
      localDeviceIdentifier,
      loading: deviceCompanyLoading,
      paired: devicePaired,
      companyId,
      pairingStatus: deviceCompany?.pairingStatus ?? null,
      error: deviceCompanyError ? String(deviceCompanyError) : null,
    })}`);
  }, [localDeviceIdentifier, deviceCompanyLoading, devicePaired, companyId, deviceCompany?.pairingStatus, deviceCompanyError]);

  useEffect(() => {
    if (!isOnline) return;
    void queryClient.invalidateQueries({ queryKey: ["device-company", localDeviceIdentifier] });
  }, [isOnline, localDeviceIdentifier, queryClient]);

  useEffect(() => {
    if (!isOnline || !companyId || pendingCount <= 0 || syncing) return;

    void syncQueue()
      .then(() => {
        setLastSyncAt(new Date().toISOString());
        console.info("[Device] Offline scans synchronized", { company_id: companyId, pending_count: pendingCount });
        queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
        queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
        queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] });
      })
      .catch((syncError) => {
        console.warn("[Device] Offline scan synchronization failed", syncError);
      });
  }, [companyId, isOnline, pendingCount, queryClient, syncQueue, syncing]);

  // Checkpoints
  const { data: checkpoints = [] } = useQuery({
    queryKey: ["checkpoints", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checkpoints")
        .select("id, name, nfc_tag_id, site_id, patrol_id, location_lat, location_lng")
        .eq("company_id", companyId!)
        .order("sort_order");

      if (error) {
        console.error("[NFCScanner] checkpoints fetch failed", { companyId, error });
        throw error;
      }

      console.info("[NFCScanner] checkpoints loaded", {
        companyId,
        siteId: deviceCompany?.siteId ?? null,
        count: data?.length ?? 0,
        tags: (data ?? []).map((checkpoint) => ({
          id: checkpoint.id,
          name: checkpoint.name,
          nfc_tag_id: checkpoint.nfc_tag_id,
          site_id: checkpoint.site_id,
        })),
      });

      if (!data?.length) {
        console.warn("[NFCScanner] no checkpoints found for paired device company", {
          companyId,
          siteId: deviceCompany?.siteId ?? null,
          deviceIdentifier: deviceCompany?.deviceIdentifier ?? localDeviceIdentifier,
        });
      }

      return data;
    },
    enabled: !!companyId,
  });

  // Patrols (for verification_level)
  const { data: patrols = [] } = useQuery({
    queryKey: ["patrols-verification", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("patrols").select("id, verification_level").eq("company_id", companyId!);
      if (error) throw error;
      return data as Array<{ id: string; verification_level: string }>;
    },
    enabled: !!companyId,
  });

  // Scan processor
  const { processScan } = useNfcScanProcessor({
    checkpoints,
    patrols,
    selectedGuardId: null,
    guardName: null,
    deviceMetadata: scanDeviceMetadata,
    companyId,
    isOnline,
    onSuccess: (result) => {
      const registeredCheckpoint = result.tagStatus === "registered" && Boolean(result.checkpointName ?? result.checkpoint?.name);
      const nextState: ScannerUiState = !isOnline ? "success_offline" : registeredCheckpoint ? "success" : "unregistered";

      playFeedbackSound(!isOnline ? "offline-queued" : registeredCheckpoint ? "scan-success" : "error");
      setScannerStatus(nextState);
      setLastCheckpoint(getScanDisplayName(result));
      setLastError(registeredCheckpoint ? null : "Tag not registered. Sent to Command Center for registration.");
      setLastScanAt(new Date().toISOString());
      addToLog(result, registeredCheckpoint);
      scheduleLowPriority(() => {
        queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
        queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
        queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] });
      });
      signalScannerHaptic(registeredCheckpoint ? "success" : "unregistered");
      console.info("[ScannerState]", {
        state: nextState,
        tagUid: result.tagId ?? null,
        checkpoint: result.checkpointName ?? result.checkpoint?.name ?? null,
        gpsStatus,
      });
      setTimeout(() => setScannerStatus("scanning"), registeredCheckpoint ? 1500 : 2500);
    },
    onFailure: (result) => {
      const locallyQueued = result.reason?.toLowerCase().includes("saved locally") ?? false;
      playFeedbackSound(locallyQueued ? "offline-queued" : "error");
      setScannerStatus(classifyFailureState(result.reason, locallyQueued));
      setLastCheckpoint(null);
      setLastError(result.reason ?? "Unknown error");
      setLastScanAt(new Date().toISOString());
      addToLog(result, false);
      console.info("[ScannerState]", { state: classifyFailureState(result.reason, locallyQueued), reason: result.reason ?? null, tagUid: result.tagId ?? null });
      setTimeout(() => setScannerStatus("scanning"), 2500);
    },    onFaceVerificationRequired: (result, scanData) => {
      // Pause scanning, show face verification
      setScannerStatus("idle");
      setPendingFaceScan({ result, scanData: scanData as FaceScanData });
      toast.info("Face verification required for this patrol");
    },
  });

  const addToLog = useCallback((result: ScanValidationResult, valid: boolean) => {
    console.debug(`[NFCScanner] session log entry ${JSON.stringify({
      valid,
      checkpointName: getScanDisplayName(result),
      resultCheckpointName: result.checkpointName,
      resultCheckpoint: result.checkpoint
        ? { id: result.checkpoint.id, name: result.checkpoint.name, nfc_tag_id: result.checkpoint.nfc_tag_id }
        : null,
      tagStatus: result.tagStatus,
      reason: result.reason ?? null,
    })}`);

    setSessionLog((prev) => [
      {
        id: crypto.randomUUID(),
        checkpointName: getScanDisplayName(result),
        timestamp: new Date().toISOString(),
        valid,
        offline: !isOnline,
      },
      ...prev,
    ].slice(0, 20));
  }, [isOnline]);

  // Handle face verification result
  const handleFaceResult = useCallback(async (faceResult: FaceVerifyResult) => {
    if (!pendingFaceScan) return;

    if (faceResult.verified) {
      const { scanData } = pendingFaceScan;
      try {
        const { guard_name: _guardName, ...scanLogData } = scanData;
        const verifiedScanData: ScanLogInsert = {
          ...scanLogData,
          is_offline_sync: false,
          face_verified: true,
          face_confidence: faceResult.confidence,
        };
        const { error } = await supabase.from("scan_logs").insert(verifiedScanData);
        if (error) throw error;

        setScannerStatus("success");
        setLastCheckpoint(getScanDisplayName(pendingFaceScan.result));
        addToLog(pendingFaceScan.result, true);
        queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
        toast.success("Triple-verified: NFC + GPS + Face ID");
      } catch {
        toast.error("Failed to save verified scan");
      }
    } else {
      setScannerStatus("save_failed");
      setLastError("Face verification failed - identity mismatch");
      addToLog(pendingFaceScan.result, false);

      if (companyId) {
        await supabase.from("alerts").insert({
          company_id: companyId,
          type: "anomaly" as const,
          severity: "high" as const,
          guard_id: null,
          message: `Face verification failed at checkpoint "${pendingFaceScan.result.checkpoint?.name}". Confidence: ${Math.round(faceResult.confidence * 100)}%. Possible identity mismatch.`,
        });
      }
      toast.error("Face mismatch - security alert generated");
    }

    setPendingFaceScan(null);
    setTimeout(() => setScannerStatus("scanning"), 3000);
  }, [addToLog, companyId, pendingFaceScan, queryClient]);
  // NFC Reader
  const nfcReader = useNfcReader({
    onScan: async ({ serialNumber }) => {
      if (!companyId) {
        const message = deviceCompanyLoading ? "Device enrollment is loading. Please wait." : "This device is not enrolled for patrol scanning.";
        console.warn(`[Scan] Ignored NFC tag without company ${JSON.stringify({
          tag_uid: serialNumber,
          localDeviceIdentifier,
          loading: deviceCompanyLoading,
          paired: devicePaired,
          pairingStatus: deviceCompany?.pairingStatus ?? null,
          error: deviceCompanyError ? String(deviceCompanyError) : null,
        })}`);
        setScannerStatus("device_unassigned");
        setLastCheckpoint(null);
        setLastError(message);
        playFeedbackSound("error");
        signalScannerHaptic("device_unassigned");
        toast.warning(message);
        setTimeout(() => setScannerStatus(nfcReader.supported ? "scanning" : "idle"), 2500);
        return;
      }

      playFeedbackSound("scan-detected");
      signalScannerHaptic("tag_detected");
      setScannerStatus("tag_detected");
      setLastTagUid(serialNumber);
      setLastCheckpoint(`Tag ${serialNumber}`);
      setLastError(null);
      console.info("[ScannerState]", { state: "tag_detected", tagUid: serialNumber });

      await sleep(180);
      setScannerStatus("verifying");
      console.info("[ScannerState]", { state: "verifying", tagUid: serialNumber });

      const scanGps = await getGpsForScan();
      setScannerStatus("saving");
      console.info("[ScannerState]", { state: "saving", tagUid: serialNumber, gpsCaptured: Boolean(scanGps) });
      const result = await processScan(serialNumber, scanGps);
      if (!scanGps && result.scanLogId) {
        toast.info("GPS unavailable, scan saved without GPS. Retrying location in background.");
        retryGpsInBackground(result.scanLogId, serialNumber);
      }
    },
    debounceMs: 3000,
  });

  useEffect(() => {
    void ensureLocationPermission().catch(() => {
      setGpsStatus("pending");
    });
  }, []);

  useEffect(() => {
    if (!companyId || !Capacitor.isNativePlatform()) return;

    let cancelled = false;
    const warmGps = async (reason: string) => {
      try {
        const location = await getDeviceLocation({ maxAgeMs: 120000 });
        if (cancelled) return;

        const nextGps = { lat: location.lat, lng: location.lng, accuracy: location.accuracy };
        setGps(nextGps);
        setGpsStatus("available");
        console.info("[GPS] Warm location ready", {
          reason,
          latitude: nextGps.lat,
          longitude: nextGps.lng,
          accuracy: nextGps.accuracy ?? null,
        });
      } catch (error) {
        if (cancelled) return;
        setGpsStatus((current) => current === "available" ? current : "pending");
        console.warn("[GPS] Warm location unavailable", { reason, error: String(error) });
      }
    };

    void warmGps("scanner-start");
    const intervalId = window.setInterval(() => void warmGps("scanner-heartbeat"), 45000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [companyId]);

  useEffect(() => {
    const handleSosFeedback = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; deviceIdentifier?: string }>).detail;
      if (detail?.status === "sending" || detail?.status === "sent") {
        playFeedbackSound("sos");
        signalScannerHaptic("sos");
        setScannerStatus("sos");
        setLastTagUid(null);
        setLastCheckpoint(detail.deviceIdentifier ?? localDeviceIdentifier);
        setLastError("Location is being shared with command center.");
        setLastScanAt(new Date().toISOString());
        console.info("[ScannerState]", { state: "sos", status: detail.status, deviceIdentifier: detail.deviceIdentifier ?? localDeviceIdentifier });
        return;
      }

      if (detail?.status === "error") {
        setScannerStatus("save_failed");
        setLastError("SOS could not be sent. Call your supervisor now.");
        signalScannerHaptic("save_failed");
        console.info("[ScannerState]", { state: "error", source: "sos" });
        setTimeout(() => setScannerStatus(nfcReader.supported ? "scanning" : "idle"), 3500);
      }
    };

    window.addEventListener("mxpatrol:sos-feedback", handleSosFeedback);
    return () => window.removeEventListener("mxpatrol:sos-feedback", handleSosFeedback);
  }, [localDeviceIdentifier]);

  useEffect(() => {
    if (!nfcReader.supported || pendingFaceScan) return;

    nfcReader.startScanning();
    setScannerStatus("scanning");

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        nfcReader.startScanning();
        setScannerStatus("scanning");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [nfcReader.supported, nfcReader.startScanning, pendingFaceScan]);

  // Sync NFC reader status with scanner status
  useEffect(() => {
    if (nfcReader.status === "scanning" && scannerStatus === "idle") {
      setScannerStatus("scanning");
    }
    if (nfcReader.status === "unsupported" || nfcReader.status === "disabled") {
      setScannerStatus(nfcReader.status as ScannerUiState);
      setLastError(nfcReader.errorMessage);
    }
  }, [nfcReader.status]);

  // Check if any assigned patrol has enhanced verification

  const getGpsForScan = async (): Promise<ScanGps> => {
    setGpsStatus("capturing");

    const cachedLocation = getCachedDeviceLocation(120000);
    if (cachedLocation) {
      const nextGps = { lat: cachedLocation.lat, lng: cachedLocation.lng, accuracy: cachedLocation.accuracy };
      setGps(nextGps);
      setGpsStatus("available");
      return nextGps;
    }

    try {
      const location = await withTimeout(getDeviceLocation({ maxAgeMs: 120000 }), 4500);
      const nextGps = { lat: location.lat, lng: location.lng, accuracy: location.accuracy };
      setGps(nextGps);
      setGpsStatus("available");
      return nextGps;
    } catch (error) {
      console.warn("[GPS] Scan location unavailable before save; will retry after insert", { error: String(error) });
      setGpsStatus("pending");
      return null;
    }
  };

  const retryGpsInBackground = (scanLogId: string, tagId: string) => {
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await sleep(5000);
        try {
          const location = await getDeviceLocation({ maxAgeMs: 120000 });
          const nextGps = { lat: location.lat, lng: location.lng, accuracy: location.accuracy };
          setGps(nextGps);
          setGpsStatus("available");

          if (companyId) {
            await updatePatrolDevicePresence({
              companyId,
              userId: null,
              gps: nextGps,
            });
          }

          if (companyId) {
            await backfillNfcScanGps({
              companyId,
              scanLogId,
              tagId,
              gps: nextGps,
            });
          }

          console.info("[GPS] Scan GPS backfilled", {
            scanLogId,
            tagUid: tagId,
            latitude: nextGps.lat,
            longitude: nextGps.lng,
            accuracy: nextGps.accuracy ?? null,
          });

          scheduleLowPriority(() => {
            queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
            queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] });
          });
          return;
        } catch (error) {
          console.warn("[GPS] Scan GPS backfill attempt failed", { scanLogId, tagUid: tagId, attempt: attempt + 1, error: String(error) });
          setGpsStatus("pending");
        }
      }

      setGpsStatus("unavailable");
    })();
  };

  const scannerShellState = getScannerShellState(scannerStatus);
  const isNativeScanner = Capacitor.isNativePlatform();
  const gpsLabel = getScannerGpsLabel(gpsStatus);
  const nfcLabel = getScannerNfcLabel(nfcReader.supported, scannerStatus);
  const assignmentLabel = companyId ? "Assigned" : deviceCompanyLoading ? "Checking" : "Not enrolled";
  const assignmentTone = companyId ? "is-good" : deviceCompanyLoading ? "is-info" : "is-warning";
  const latestFeedback = getScannerFeedback(scannerStatus, lastCheckpoint, lastError, pendingCount, deviceCompanyLoading, Boolean(companyId));
  const activityTime = formatScannerTime(lastScanAt ?? lastSyncAt);

  return (
    <div className={"scanner-shell scanner-page scanner-state-" + scannerShellState + (isNativeScanner ? " scanner-native" : " scanner-web") + " relative min-h-[100vh] overflow-hidden bg-[#020711] text-white lg:min-h-[calc(100vh-4rem)]"}>
      <HardwareSosListener />
      <div className="scanner-ambient-bg" aria-hidden="true" />

      <header className="web-scanner-header" aria-label="MX Patrol web scanner header">
        <div className="web-scanner-title-group">
          <TTechMxPatrolLogo variant="header" priority className="web-scanner-logo" />
          <div className="web-scanner-title-divider" aria-hidden="true" />
          <div>
            <p className="web-scanner-kicker">Web Scanner</p>
            <p className="web-scanner-subtitle">Secure patrol scan console</p>
          </div>
        </div>
        <div className="web-scanner-header-actions">
          <span className={"web-scanner-live-pill " + (isOnline ? "is-live" : "is-offline")}>
            <span aria-hidden="true" />
            {isOnline ? "LIVE" : "OFFLINE"}
          </span>
          <Button asChild size="sm" variant="ghost" className="web-scanner-supervisor-button">
            <Link to="/login?supervisor=1">Supervisor</Link>
          </Button>
        </div>
      </header>

      <main className="web-scanner-shell">
        {!companyId && (
          <section className="web-scanner-enrollment-card web-scanner-sidebar-item" aria-label="Device enrollment status">
            <div className="web-scanner-enrollment-header">
              <span className="web-scanner-warning-icon" aria-hidden="true">!</span>
              <div className="web-scanner-enrollment-copy">
                <h2>
                  {deviceCompanyLoading
                    ? "Checking device enrollment"
                    : deviceCompanyError
                      ? "Could not verify this device"
                      : "Device not enrolled"}
                </h2>
                <p>
                  {deviceCompanyError
                    ? "Check the network connection and retry. Scanning resumes automatically once the device is verified."
                    : "Enroll this RG360 with a supervisor QR token before patrol scanning."}
                </p>
              </div>
            </div>
            <div className="web-scanner-device-code" aria-label={`Device identifier ${localDeviceIdentifier}`}>
              {localDeviceIdentifier}
            </div>
            <div className="web-scanner-enrollment-actions">
              {deviceCompanyError ? (
                <Button
                  size="sm"
                  className="web-scanner-action-button web-scanner-action-primary"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["device-company", localDeviceIdentifier] })}
                >
                  Retry
                </Button>
              ) : (
                <Button asChild size="sm" className="web-scanner-action-button web-scanner-action-primary">
                  <Link to="/enroll">Enroll Device</Link>
                </Button>
              )}
              <Button asChild size="sm" variant="outline" className="web-scanner-action-button web-scanner-action-secondary">
                <Link to="/login?supervisor=1">Supervisor Login</Link>
              </Button>
            </div>
          </section>
        )}

        <section className="web-scanner-panel-card web-scanner-sidebar-item web-scanner-patrol-card" aria-label="Patrol scanner status">
          <div className="web-scanner-section-heading">
            <p>Patrol scanner</p>
          </div>
          <p className="web-scanner-panel-copy">
            {companyId ? "Scanner is ready. Hold the device near the checkpoint tag." : "Ready for device enrollment before patrol scanning."}
          </p>
        </section>

        <section className="web-scanner-panel-card web-scanner-sidebar-item web-scanner-system-card" aria-label="System status">
          <p className="web-scanner-card-title">System Status</p>
          <div className="web-scanner-status-list">
            <div className="web-scanner-status-row"><span>GPS</span><strong className={gpsStatus === "unavailable" ? "is-warning" : "is-good"}>{gpsLabel}</strong></div>
            <div className="web-scanner-status-row"><span>Network</span><strong className={isOnline ? "is-good" : "is-warning"}>{isOnline ? "Online" : "Offline"}</strong></div>
            <div className="web-scanner-status-row"><span>Sync Queue</span><strong className={pendingCount > 0 ? "is-warning" : "is-good"}>{pendingCount} Pending</strong></div>
            <div className="web-scanner-status-row"><span>NFC</span><strong className={nfcReader.supported ? "is-good" : "is-danger"}>{nfcLabel}</strong></div>
            <div className="web-scanner-status-row"><span>Device Assignment</span><strong className={assignmentTone}>{assignmentLabel}</strong></div>
          </div>
        </section>

        <section className="web-scanner-panel-card web-scanner-sidebar-item web-scanner-feedback-card web-scanner-latest-card" aria-label="Latest scanner activity">
          <div className="web-scanner-section-heading">
            <span className={"web-scanner-feedback-dot " + latestFeedback.tone} aria-hidden="true" />
            <p>Latest Activity</p>
          </div>
          <div className="web-scanner-latest-body">
            <div>
              <span>{latestFeedback.title}</span>
              <span>{activityTime}</span>
            </div>
            <p>{latestFeedback.detail}</p>
          </div>
        </section>

        <section className="web-scanner-visual-panel" aria-label="NFC scanner video">
          <div className="scanner-stage">
            <div className="scanner-media-shell web-scanner-media-shell">
              <video
                ref={videoRef}
                className="scanner-background-video"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                controls={false}
                poster="/assets/rg360/nfcscanner-poster.jpg"
                aria-hidden="true"
              >
                <source src="/assets/rg360/nfcscanner.mp4" type="video/mp4" />
              </video>
              <div className="scanner-dark-overlay" />

              <p className="sr-only" aria-live="polite">
                {scannerStatus === "idle" || scannerStatus === "scanning" || scannerStatus === "initializing"
                  ? "NFC scanner ready"
                  : scannerStatus + (lastCheckpoint ? " " + lastCheckpoint : "")}
              </p>

              <AnimatePresence>
                {pendingFaceScan && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="scanner-face-panel relative z-10 mx-4 mt-auto mb-4"
                  >
                    <div className="space-y-3 rounded-xl border border-primary/30 bg-black/82 p-4 backdrop-blur-sm">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        <div>
                          <p className="text-sm font-bold text-white">Face Verification Required</p>
                          <p className="text-xs text-white/70">
                            Checkpoint: {pendingFaceScan.result.checkpoint?.name ?? "Unknown"} - NFC + GPS + Face ID pending
                          </p>
                        </div>
                      </div>
                      <Suspense
                        fallback={(
                          <div className="rounded-xl border border-white/15 p-6 text-center text-sm text-white/65">
                            Loading face verification...
                          </div>
                        )}
                      >
                        <FaceVerification
                          guardPhotoUrl={null}
                          onResult={handleFaceResult}
                        />
                      </Suspense>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-white/65"
                        onClick={() => {
                          setPendingFaceScan(null);
                          setScannerStatus(nfcReader.supported ? "scanning" : "idle");
                          toast.warning("Face verification skipped - scan not recorded");
                        }}
                      >
                        Cancel Verification
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!pendingFaceScan && (
                <div className="scanner-feedback-layer pointer-events-none absolute inset-0 z-10 flex items-end justify-center px-4 pb-16">
                  <ScannerRing
                    status={scannerStatus}
                    checkpointName={lastCheckpoint}
                    errorReason={lastError}
                    tagUid={lastTagUid}
                    gpsStatus={gpsStatus}
                    isOnline={isOnline}
                    pendingCount={pendingCount}
                    scannedAt={lastScanAt}
                  />
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="web-scanner-footer" aria-label="Scanner footer">
        <span>MX Patrol Web Scanner</span>
        <span>Secure Patrol System</span>
        <span>(c) 2025 TTECH</span>
      </footer>
    </div>
  );
};
const getScanDisplayName = (result: ScanValidationResult) =>
  result.checkpointName
  ?? result.checkpoint?.name
  ?? (result.tagStatus === "registered" ? "Registered checkpoint" : "Unregistered");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

type NavigatorWithActivation = Navigator & {
  userActivation?: { hasBeenActive?: boolean };
};

type ScannerHapticKind =
  | "tag_detected"
  | "success"
  | "success_offline"
  | "duplicate"
  | "unregistered"
  | "save_failed"
  | "device_unassigned"
  | "sos";

const signalScannerHaptic = (kind: ScannerHapticKind) => {
  const nav = navigator as NavigatorWithActivation;
  if (!nav.userActivation?.hasBeenActive) return;

  const patterns: Record<ScannerHapticKind, number | number[]> = {
    tag_detected: 35,
    success: [45, 40, 80],
    success_offline: [50, 60, 50],
    duplicate: [35, 45, 35],
    unregistered: [80, 55, 80],
    save_failed: [120, 70, 120],
    device_unassigned: [90, 60, 90],
    sos: [180, 90, 180, 90, 180],
  };

  try {
    nav.vibrate?.(patterns[kind]);
  } catch {
    // Some Android WebViews block vibration unless triggered by a direct tap.
  }
};

const classifyFailureState = (reason?: string | null, locallyQueued = false): ScannerUiState => {
  const text = reason?.toLowerCase() ?? "";

  if (locallyQueued || /saved locally|sync is queued/.test(text)) return "success_offline";
  if (/duplicate|already scanned/.test(text)) return "duplicate";
  if (/not registered|unregistered|unknown tag/.test(text)) return "unregistered";
  if (/company|enroll|assigned|paired/.test(text)) return "device_unassigned";
  return "save_failed";
};

const getScannerShellState = (status: ScannerUiState) => {
  if (status === "idle" || status === "scanning" || status === "initializing") return "ready";
  if (status === "acquiring_gps" || status === "verifying" || status === "saving") return "verifying";
  if (status === "error") return "save_failed";
  if (status === "unsupported" || status === "disabled") return "device_unassigned";
  return status;
};
const getScannerGpsLabel = (status: "idle" | "capturing" | "available" | "pending" | "unavailable") => {
  if (status === "available") return "Ready";
  if (status === "capturing") return "Capturing";
  if (status === "pending") return "Searching";
  if (status === "unavailable") return "Unavailable";
  return "Ready";
};

const getScannerNfcLabel = (supported: boolean, status: ScannerUiState) => {
  if (!supported) return "Unavailable";
  if (status === "disabled") return "Disabled";
  if (status === "unsupported") return "Unsupported";
  return "Active";
};

const getScannerFeedback = (
  status: ScannerUiState,
  checkpointName: string | null,
  errorReason: string | null,
  pendingCount: number,
  deviceCompanyLoading: boolean,
  hasCompany: boolean,
) => {
  if (!hasCompany) {
    return {
      tone: deviceCompanyLoading ? "is-info" : "is-warning",
      title: deviceCompanyLoading ? "Checking device" : "Enrollment required",
      detail: deviceCompanyLoading ? "Verifying this RG360 before scanning." : "Enroll this device before patrol scanning.",
    };
  }

  switch (status) {
    case "tag_detected":
      return { tone: "is-info", title: "Tag detected", detail: checkpointName ?? "Hold steady while MX Patrol verifies the tag." };
    case "acquiring_gps":
      return { tone: "is-info", title: "Getting GPS", detail: "Capturing location for this checkpoint scan." };
    case "verifying":
      return { tone: "is-info", title: "Verifying checkpoint", detail: checkpointName ?? "Checking tag against registered checkpoints." };
    case "saving":
      return { tone: "is-info", title: "Saving scan", detail: "Writing checkpoint scan securely." };
    case "success":
      return { tone: "is-good", title: "Checkpoint verified", detail: checkpointName ?? "Scan saved successfully." };
    case "success_offline":
      return { tone: "is-warning", title: "Saved offline", detail: `${pendingCount} pending sync${pendingCount === 1 ? "" : "s"}.` };
    case "duplicate":
      return { tone: "is-warning", title: "Already scanned", detail: checkpointName ?? "Duplicate checkpoint scan detected." };
    case "unregistered":
      return { tone: "is-danger", title: "Unknown checkpoint", detail: errorReason ?? "Tag is not registered for this site." };
    case "save_failed":
    case "error":
      return { tone: "is-danger", title: "Scan save delayed", detail: errorReason ?? "MX Patrol will retry automatically where possible." };
    case "device_unassigned":
      return { tone: "is-warning", title: "Device not assigned", detail: errorReason ?? "Contact a supervisor to assign this device." };
    case "sos":
      return { tone: "is-danger", title: "SOS active", detail: "Alert sent to control room." };
    default:
      return { tone: "is-good", title: "Ready to scan", detail: "Hold the device near the checkpoint tag." };
  }
};

const formatScannerTime = (iso: string | null) => {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
export default NFCScanner;




















