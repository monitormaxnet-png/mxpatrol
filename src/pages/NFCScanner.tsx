import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
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
import { AlertTriangle, Battery, Check, CloudOff, CloudUpload, Loader2, Lock, MapPin, Radio, ShieldAlert, Smartphone, Wifi, WifiOff, Wrench, X } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";
import { ensureLocationPermission, getCachedDeviceLocation, getDeviceLocation } from "@/lib/deviceGeolocation";
import { updatePatrolDevicePresence } from "@/lib/devicePresence";
import { backfillNfcScanGps } from "@/lib/nfcWorkflow";
import { getLocalDeviceIdentifier, resolveDeviceCompany } from "@/lib/deviceCompany";
import { getSecureDeviceBlockedReason, getSecureDeviceState, type SecureDeviceNativeState } from "@/lib/secureDevice";
import { batteryMetadata } from "@/lib/deviceBattery";
import { playFeedbackSound } from "@/lib/feedbackSound";
import { describeScanResult, formatProgress, type StructuredScanResult } from "@/lib/scanResult";
import DataLogFormOverlay from "@/components/scanner/DataLogFormOverlay";
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
type CurrentPatrolRow = {
  id: string;
  status: string | null;
  checkpoint_completed: number | null;
  checkpoint_total: number | null;
  scheduled_start: string | null;
  site_id: string | null;
  device_identifier: string | null;
  patrol_routes?: { name: string | null } | Array<{ name: string | null }> | null;
  patrol_templates?: { name: string | null } | Array<{ name: string | null }> | null;
  patrol_session_checkpoints?: Array<{
    id: string;
    status: string | null;
    scheduled_order: number | null;
    scheduled_at: string | null;
    scanned_at: string | null;
    checkpoints?: { name: string | null; nfc_tag_id: string | null } | Array<{ name: string | null; nfc_tag_id: string | null }> | null;
  }> | null;
};

type ActivePatrolDisplay = {
  name: string;
  completed: number;
  required: number;
  progressPercent: number;
  nextCheckpoint: string | null;
  status?: string | null;
} | null;

type ScannerRestrictedKind = "active" | "startup_check" | "unpaired" | "locked" | "maintenance" | "disabled" | "update_required" | "security_failed";
type ScannerRestrictedState = {
  kind: ScannerRestrictedKind;
  title: string;
  detail: string;
  action?: string;
  expiresAt?: string | null;
  tone: "info" | "warning" | "danger";
};

type PairingCodeResponse = { ok?: boolean; display_code?: string; pairing_code?: string; expires_at?: string; error?: string };

const NFCScanner = () => {
  const queryClient = useQueryClient();
  const { syncQueue, syncing, pendingCount } = useOfflineScanQueue();

  const [gps, setGps] = useState<ScanGps>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "capturing" | "available" | "pending" | "unavailable">("idle");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [sessionLog, setSessionLog] = useState<ScanLogEntry[]>([]);
  const [scannerStatus, setScannerStatus] = useState<ScannerUiState>("initializing");
  const [lastCheckpoint, setLastCheckpoint] = useState<string | null>(null);
  const [lastTagUid, setLastTagUid] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastStructuredResult, setLastStructuredResult] = useState<StructuredScanResult | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [pendingDataLog, setPendingDataLog] = useState<{ result: StructuredScanResult; checkpointName: string } | null>(null);
  const [dataLogOpen, setDataLogOpen] = useState(false);
  const [submittingDataLog, setSubmittingDataLog] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const { battery } = useDeviceBattery();
  const scanDeviceMetadata = useMemo(() => batteryMetadata(battery), [battery]);

  // Face verification state
  const [pendingFaceScan, setPendingFaceScan] = useState<{
    result: ScanValidationResult;
    scanData: FaceScanData;
  } | null>(null);

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
  const isNativeScanner = Capacitor.isNativePlatform();
  const { data: secureNativeState = null } = useQuery({
    queryKey: ["secure-device-state", localDeviceIdentifier],
    queryFn: getSecureDeviceState,
    enabled: isNativeScanner,
    refetchInterval: isNativeScanner ? 30000 : false,
  });
  const restrictedState = getRestrictedScannerState({
    deviceCompany,
    deviceCompanyLoading,
    deviceCompanyError,
    secureNativeState,
    isNativeScanner,
  });
  const scannerBlocked = restrictedState.kind !== "active";
  const scannerBlockedStatus = restrictedStateToScannerStatus(restrictedState.kind);

  const { data: pairingRequest = null } = useQuery({
    queryKey: ["device-pairing-code", localDeviceIdentifier, restrictedState.kind],
    enabled: restrictedState.kind === "unpaired" && isOnline && !deviceCompanyLoading,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("device-pair", {
        body: {
          mode: "request_code",
          device_metadata: {
            device_identifier: localDeviceIdentifier,
            device_name: "RG360",
            device_type: "pda",
            model: "RG360",
            platform: Capacitor.getPlatform(),
          },
        },
      });
      const payload = data as PairingCodeResponse | null;
      if (error || !payload?.ok) throw new Error(payload?.error ?? error?.message ?? "Could not issue pairing code");
      return payload;
    },
  });

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
        const syncedAt = new Date().toISOString();
        setLastSyncAt(syncedAt);
        if (pendingCount > 0 && !["tag_detected", "verifying", "acquiring_gps", "saving"].includes(scannerStatus)) {
          setScannerStatus("success");
          setLastCheckpoint("Offline queue");
          setLastError("Scan synchronized successfully.");
          setLastStructuredResult(null);
          setLastScanAt(syncedAt);
          window.setTimeout(() => {
          setLastError(null);
          setScannerStatus("scanning");
        }, 1200);
        }
        console.info("[Device] Offline scans synchronized", { company_id: companyId, pending_count: pendingCount });
        queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
        queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
        queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] });
      })
      .catch((syncError) => {
        console.warn("[Device] Offline scan synchronization failed", syncError);
      });
  }, [companyId, isOnline, pendingCount, queryClient, scannerStatus, syncQueue, syncing]);

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


  const { data: currentPatrol = null } = useQuery({
    queryKey: ["scanner-current-patrol", companyId, deviceCompany?.siteId, deviceCompany?.deviceIdentifier],
    enabled: !!companyId && !scannerBlocked,
    queryFn: async () => {
      let query = supabase
        .from("patrol_sessions")
        .select("id, status, checkpoint_completed, checkpoint_total, scheduled_start, site_id, device_identifier, patrol_routes(name), patrol_templates(name), patrol_session_checkpoints(id, status, scheduled_order, scheduled_at, scanned_at, checkpoints(name, nfc_tag_id))")
        .eq("company_id", companyId!)
        .in("status", ["scheduled", "awaiting_start", "active", "in_progress", "late_start", "late", "delayed", "incomplete"])
        .order("scheduled_start", { ascending: false })
        .limit(1);
      if (deviceCompany?.siteId) query = query.eq("site_id", deviceCompany.siteId);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as CurrentPatrolRow | null;
    },
  });  // Scan processor
  const { processScan } = useNfcScanProcessor({
    checkpoints,
    patrols,
    selectedGuardId: null,
    guardName: null,
    deviceMetadata: scanDeviceMetadata,
    companyId,
    isOnline,
    onSuccess: (result) => {
      const structured = result.structured ?? null;
      setLastStructuredResult(structured);
      const registeredCheckpoint = result.tagStatus === "registered" && Boolean(result.checkpointName ?? result.checkpoint?.name);

      const feedback = !isOnline
        ? describeScanResult({
            success: true,
            code: "OFFLINE_SAVED",
            scan_id: null,
            checkpoint: null,
            patrol: null,
            next_checkpoint: null,
            duplicate: false,
            offline_replay: false,
            message: "",
          })
        : structured
          ? describeScanResult(structured)
          : describeScanResult({
              success: true,
              code: registeredCheckpoint ? "NO_ACTIVE_PATROL" : "UNREGISTERED_CHECKPOINT",
              scan_id: result.scanLogId ?? null,
              checkpoint: result.checkpoint ? { id: result.checkpoint.id, name: result.checkpointName ?? result.checkpoint.name } : null,
              patrol: null,
              next_checkpoint: null,
              duplicate: false,
              offline_replay: false,
              message: "",
            });

      const nextState = feedback.uiState as ScannerUiState;
      playFeedbackSound(feedback.sound);
      setScannerStatus(nextState);
      setLastCheckpoint(getScanDisplayName(result));
      setLastError(feedback.detail);
      setLastScanAt(new Date().toISOString());
      addToLog(result, registeredCheckpoint);
      scheduleLowPriority(() => {
        queryClient.invalidateQueries({ queryKey: ["recent_scans"] });
        queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
        queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] });
        queryClient.invalidateQueries({ queryKey: ["scheduled-patrols"] });
        queryClient.invalidateQueries({ queryKey: ["patrol_sessions"] });
        queryClient.invalidateQueries({ queryKey: ["patrols"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      });
      if (structured?.data_log_required && structured.data_log_form && structured.scan_id) {
        setPendingDataLog({ result: structured, checkpointName: getScanDisplayName(result) });
        setDataLogOpen(true);
        setScannerStatus("awaiting_data");
      }
      signalScannerHaptic(registeredCheckpoint ? "success" : "unregistered");
      console.info("[ScannerState]", {
        state: nextState,
        code: structured?.code ?? null,
        tagUid: result.tagId ?? null,
        checkpoint: result.checkpointName ?? result.checkpoint?.name ?? null,
        patrol: structured?.patrol?.name ?? null,
        selectionReason: structured?.patrol?.selection_reason ?? null,
        progress: formatProgress(structured?.patrol ?? null),
        gpsStatus,
      });
      if (!(structured?.data_log_required && structured.data_log_form)) {
        setTimeout(() => setScannerStatus("scanning"), feedback.holdMs);
      }
    },
    onFailure: (result) => {
      setLastStructuredResult(result.structured ?? null);
      const locallyQueued = result.reason?.toLowerCase().includes("saved locally") ?? false;
      playFeedbackSound(locallyQueued ? "offline-queued" : "error");
      setScannerStatus(classifyFailureState(result.reason, locallyQueued));
      setLastCheckpoint(null);
      setLastError(result.reason ?? "Unknown error");
      setLastScanAt(new Date().toISOString());
      addToLog(result, false);
      console.info("[ScannerState]", { state: classifyFailureState(result.reason, locallyQueued), reason: result.reason ?? null, tagUid: result.tagId ?? null });
      setTimeout(() => setScannerStatus("scanning"), 2500);
    },
    onFaceVerificationRequired: (result, scanData) => {
      // Pause scanning, show face verification
      setScannerStatus("idle");
      setPendingFaceScan({ result, scanData: scanData as FaceScanData });
      toast.info("Face verification required for this patrol");
    },
  });

  const submitDataLog = useCallback(
    async (responses: Record<string, unknown>) => {
      if (!pendingDataLog?.result.scan_id || !companyId) return;
      setSubmittingDataLog(true);
      try {
        const { data, error } = await supabase.functions.invoke("device-data-log", {
          body: {
            company_id: companyId,
            device_identifier: deviceCompany?.deviceIdentifier ?? localDeviceIdentifier,
            scan_log_id: pendingDataLog.result.scan_id,
            responses,
          },
        });
        const payload = data as { ok?: boolean; error?: string } | null;
        if (error || !payload?.ok) throw new Error(payload?.error ?? error?.message ?? "Data log submission failed");

        playFeedbackSound("scan-success");
        toast.success("Saved successfully");
        setPendingDataLog(null);
        setDataLogOpen(false);
        setScannerStatus("success");
        setLastError("SAVED SUCCESSFULLY");
        queryClient.invalidateQueries({ queryKey: ["patrol_sessions"] });
        queryClient.invalidateQueries({ queryKey: ["scheduled-patrols"] });
        setTimeout(() => {
          setLastError(null);
          setScannerStatus("scanning");
        }, 1200);
      } catch (submitError) {
        playFeedbackSound("error");
        toast.error(submitError instanceof Error ? submitError.message : "Data log submission failed");
      } finally {
        setSubmittingDataLog(false);
      }
    },
    [companyId, deviceCompany?.deviceIdentifier, localDeviceIdentifier, pendingDataLog, queryClient],
  );

  const skipDataLog = useCallback(() => {
    if (submittingDataLog) return;
    setPendingDataLog(null);
    setDataLogOpen(false);
    setLastError(null);
    // The scan-resume effect reacts to pendingDataLog clearing and restarts NFC.
    toast.info("Data log skipped - you can keep scanning");
  }, [submittingDataLog]);

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
      if (scannerBlocked) {
        setScannerStatus(scannerBlockedStatus);
        setLastCheckpoint(null);
        setLastStructuredResult(null);
        setLastError(restrictedState.detail);
        playFeedbackSound("error");
        signalScannerHaptic("device_unassigned");
        return;
      }

      if (pendingDataLog) {
        setScannerStatus("awaiting_data");
        setLastError("Complete the checkpoint data log before scanning the next tag.");
        signalScannerHaptic("duplicate");
        return;
      }

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
        setLastStructuredResult(null);
        setLastError(message);
        playFeedbackSound("error");
        signalScannerHaptic("device_unassigned");
        toast.warning(message);
        setTimeout(() => setScannerStatus(nfcSupported ? "scanning" : "idle"), 2500);
        return;
      }

      playFeedbackSound("scan-detected");
      signalScannerHaptic("tag_detected");
      setScannerStatus("tag_detected");
      setLastTagUid(serialNumber);
      setLastCheckpoint(`Tag ${serialNumber}`);
      setLastStructuredResult(null);
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

  const { errorMessage: nfcErrorMessage, startScanning: startNfcScanning, stopScanning: stopNfcScanning, status: nfcStatus, supported: nfcSupported } = nfcReader;

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
        setLastStructuredResult(null);
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
        setTimeout(() => setScannerStatus(nfcSupported ? "scanning" : "idle"), 3500);
      }
    };

    window.addEventListener("mxpatrol:sos-feedback", handleSosFeedback);
    return () => window.removeEventListener("mxpatrol:sos-feedback", handleSosFeedback);
  }, [localDeviceIdentifier, nfcSupported]);

  useEffect(() => {
    if (scannerBlocked) {
      void stopNfcScanning();
      setScannerStatus(scannerBlockedStatus);
      setLastError(restrictedState.detail);
      return;
    }

    if (pendingDataLog) {
      void stopNfcScanning();
      setScannerStatus("awaiting_data");
      return;
    }

    if (!nfcSupported || pendingFaceScan) return;

    startNfcScanning();
    setScannerStatus("scanning");

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        startNfcScanning();
        setScannerStatus("scanning");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [nfcSupported, pendingDataLog, pendingFaceScan, restrictedState.detail, scannerBlocked, scannerBlockedStatus, startNfcScanning, stopNfcScanning]);

  // Sync NFC reader status with scanner status
  useEffect(() => {
    if (nfcStatus === "scanning" && scannerStatus === "idle") {
      setScannerStatus("scanning");
    }
    if (nfcStatus === "unsupported" || nfcStatus === "disabled") {
      setScannerStatus(nfcStatus as ScannerUiState);
      setLastError(nfcErrorMessage);
    }
  }, [nfcErrorMessage, nfcStatus, scannerStatus]);

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

  const scannerStatusForDisplay = getScannerDisplayStatus({
    status: scannerBlocked ? scannerBlockedStatus : scannerStatus,
    syncing,
    batteryLevel: battery?.level,
    gpsStatus,
    scannerBlocked,
    pendingDataLog: Boolean(pendingDataLog),
    pendingFaceScan: Boolean(pendingFaceScan),
  });
  const scannerShellState = getScannerShellState(scannerStatusForDisplay);
  const gpsLabel = getScannerGpsLabel(gpsStatus);
  const nfcLabel = getScannerNfcLabel(nfcSupported, scannerStatusForDisplay);
  const latestFeedback = getScannerFeedback(scannerStatusForDisplay, lastCheckpoint, lastError, pendingCount, deviceCompanyLoading, Boolean(companyId));
  const activePatrol = getActivePatrolDisplay(lastStructuredResult, currentPatrol);
  const deviceLabel = deviceCompany?.deviceName || deviceCompany?.deviceIdentifier || localDeviceIdentifier;
  const siteLabel = deviceCompany?.siteId ? "Assigned Site" : "Unassigned";
  const batteryLabel = battery?.level != null ? `${battery.level}%` : "--";
  const kioskLabel = secureNativeState?.kioskActive || deviceCompany?.secureModeEnabled ? "Active" : "Inactive";
  const pairingCode = pairingRequest?.display_code ?? pairingRequest?.pairing_code ?? localDeviceIdentifier;

  return (
    <div className={`rg360-terminal scanner-shell scanner-page scanner-state-${scannerShellState} ${isNativeScanner ? "scanner-native" : "scanner-web"}`}>
      <HardwareSosListener />
      {!isNativeScanner ? <div className="rg360-web-float"><WebScannerActions /></div> : null}
      <main className="rg360-screen" aria-label="RG360 MX Patrol scanner">
        {scannerBlocked ? (
          <RestrictedScannerScreen
            state={restrictedState}
            deviceLabel={deviceLabel}
            siteLabel={siteLabel}
            pairingCode={pairingCode}
            isOnline={isOnline}
          showWebFallback={!isNativeScanner}
          />
        ) : pendingFaceScan ? (
          <section className="rg360-face-panel" aria-label="Face verification required">
            <TTechMxPatrolLogo variant="header" priority className="rg360-logo" />
            <div className="rg360-state-icon rg360-tone-warning"><ShieldAlert className="h-12 w-12" /></div>
            <h1>FACE VERIFICATION</h1>
            <p>{pendingFaceScan.result.checkpoint?.name ?? "Checkpoint"}</p>
            <Suspense fallback={<div className="rg360-loading"><Loader2 className="h-5 w-5 animate-spin" /> Loading face verification...</div>}>
              <FaceVerification guardPhotoUrl={null} onResult={handleFaceResult} />
            </Suspense>
            <Button
              type="button"
              className="rg360-secondary-action"
              disabled={submittingDataLog}
              onClick={() => {
                setPendingFaceScan(null);
                setScannerStatus(nfcSupported ? "scanning" : "idle");
                toast.warning("Face verification skipped - scan not recorded");
              }}
            >
              CANCEL VERIFICATION
            </Button>
          </section>
        ) : pendingDataLog?.result.data_log_form && dataLogOpen ? (
          <DataLogFormOverlay
            form={pendingDataLog.result.data_log_form}
            checkpointName={pendingDataLog.checkpointName}
            submitting={submittingDataLog}
            onSubmit={submitDataLog}
            onCancel={skipDataLog}
          />
        ) : (
          <>
            <header className="rg360-header">
              <span className="rg360-time">{formatScannerTime(null)}</span>
              <TTechMxPatrolLogo variant="header" priority className="rg360-logo" />
              <DeviceIdentityCard deviceLabel={deviceLabel} siteLabel={siteLabel} isOnline={isOnline} />
            </header>

            <ScannerRing
              status={scannerStatusForDisplay}
              checkpointName={lastCheckpoint}
              errorReason={lastError}
              tagUid={lastTagUid}
              gpsStatus={gpsStatus}
              isOnline={isOnline}
              pendingCount={pendingCount}
              scannedAt={lastScanAt}
              structuredResult={lastStructuredResult}
              deviceIdentifier={deviceCompany?.deviceIdentifier ?? localDeviceIdentifier}
              activePatrol={activePatrol}
              feedbackTitle={latestFeedback.title}
              feedbackDetail={latestFeedback.detail}
            />
            <PatrolContextCard patrol={activePatrol} latestFeedback={latestFeedback.detail} />

            <StatusFooter
              gpsLabel={gpsLabel}
              nfcLabel={nfcLabel}
              kioskLabel={kioskLabel}
              batteryLabel={batteryLabel}
              isOnline={isOnline}
              pendingCount={pendingCount}
            />
          </>
        )}
      </main>
    </div>
  );
};

function WebScannerActions() {
  return (
    <div className="rg360-web-actions" aria-label="Web enrollment and login actions">
      <a className="rg360-primary-action" href="/enroll">OPEN ENROLLMENT</a>
      <a className="rg360-secondary-action" href="/login?supervisor=1">SUPERVISOR LOGIN</a>
    </div>
  );
}
function DeviceIdentityCard({ deviceLabel, siteLabel, isOnline }: { deviceLabel: string; siteLabel: string; isOnline: boolean }) {
  return (
    <section className="rg360-device-card" aria-label="Device identity">
      <div><span>Device:</span><strong>{deviceLabel}</strong></div>
      <div><span>Site:</span><strong>{siteLabel}</strong></div>
      <span className={isOnline ? "rg360-online" : "rg360-offline"}>{isOnline ? "Online" : "Offline"}</span>
    </section>
  );
}

function PatrolContextCard({ patrol, latestFeedback }: { patrol: ActivePatrolDisplay; latestFeedback: string }) {
  const completed = patrol?.completed ?? 0;
  const required = patrol?.required ?? 0;
  const percent = patrol?.progressPercent ?? 0;
  return (
    <section className="rg360-patrol-card" aria-label="Current patrol">
      <div className="rg360-row"><span>Patrol:</span><strong>{patrol?.name ?? "Awaiting patrol"}</strong></div>
      <div className="rg360-row"><span>Progress:</span><strong>{required ? `${completed} / ${required} checkpoints` : "Ready"}</strong></div>
      <div className="rg360-progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="rg360-row"><span>Next:</span><strong>{patrol?.nextCheckpoint ?? latestFeedback}</strong></div>
    </section>
  );
}

function StatusFooter({ gpsLabel, nfcLabel, kioskLabel, batteryLabel, isOnline, pendingCount }: { gpsLabel: string; nfcLabel: string; kioskLabel: string; batteryLabel: string; isOnline: boolean; pendingCount: number }) {
  return (
    <footer className="rg360-status-footer" aria-label="Scanner status">
      <StatusChip icon={MapPin} label="GPS" value={gpsLabel} tone={gpsLabel === "Unavailable" ? "warning" : "success"} />
      <StatusChip icon={Smartphone} label="Kiosk" value={kioskLabel} tone={kioskLabel === "Active" ? "success" : "warning"} />
      <StatusChip icon={Battery} label="Batt." value={batteryLabel} tone="success" />
      <StatusChip icon={isOnline ? Wifi : WifiOff} label={isOnline ? "Sync" : "Offline"} value={pendingCount ? `${pendingCount} queued` : nfcLabel} tone={isOnline ? "success" : "info"} />
    </footer>
  );
}

function StatusChip({ icon: Icon, label, value, tone }: { icon: typeof Wifi; label: string; value: string; tone: "success" | "warning" | "info" | "danger" }) {
  return (
    <div className={`rg360-status-chip rg360-chip-${tone}`}>
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RestrictedScannerScreen({ state, deviceLabel, siteLabel, pairingCode, isOnline, showWebFallback }: { state: ScannerRestrictedState; deviceLabel: string; siteLabel: string; pairingCode: string; isOnline: boolean; showWebFallback: boolean }) {
  const isPairing = state.kind === "unpaired";
  const Icon = state.kind === "maintenance" ? Wrench : state.kind === "startup_check" ? Loader2 : state.kind === "update_required" ? CloudUpload : state.kind === "security_failed" ? ShieldAlert : state.kind === "disabled" || state.kind === "locked" ? Lock : AlertTriangle;
  return (
    <section className={`rg360-restricted rg360-restricted-${state.tone}`} aria-live="assertive">
      <span className="rg360-time">{formatScannerTime(null)}</span>
      <TTechMxPatrolLogo variant="header" priority className="rg360-logo" />
      <div className={`rg360-state-icon rg360-tone-${state.tone === "danger" ? "error" : state.tone}`}>
        <Icon className={state.kind === "startup_check" ? "h-14 w-14 animate-spin" : "h-14 w-14"} />
      </div>
      <h1>{state.title}</h1>
      <p>{state.detail}</p>
      {state.expiresAt ? <strong className="rg360-countdown">Expires in: {formatMaintenanceCountdown(state.expiresAt)}</strong> : null}
      {isPairing ? (
        <div className="rg360-pair-code" aria-label="Device pairing code">
          <span>PAIRING CODE</span>
          <strong>{isOnline ? pairingCode : "OFFLINE"}</strong>
        </div>
      ) : null}
      <div className="rg360-lock-details">
        <div><span>Device</span><strong>{deviceLabel}</strong></div>
        <div><span>Site</span><strong>{siteLabel}</strong></div>
      </div>
      <small>{state.action ?? (isPairing ? "Use this code in MX Patrol Management AI to approve this RG360." : "Contact system administration.")}</small>
    </section>
  );
}

function getRestrictedScannerState(input: { deviceCompany: { pairingStatus?: string | null; secureModeEnabled?: boolean | null; secureModeStatus?: string | null; maintenanceExpiresAt?: string | null } | null | undefined; deviceCompanyLoading: boolean; deviceCompanyError: unknown; secureNativeState: SecureDeviceNativeState | null; isNativeScanner: boolean }): ScannerRestrictedState {
  if (input.deviceCompanyLoading) {
    return { kind: "startup_check", title: "SECURITY CHECK", detail: "Verifying device enrollment and scanner authorization.", tone: "info" };
  }

  const status = input.deviceCompany?.secureModeStatus ?? null;
  const pairingStatus = input.deviceCompany?.pairingStatus ?? null;

  if (!input.deviceCompany || pairingStatus !== "paired") {
    return {
      kind: "unpaired",
      title: input.deviceCompanyError ? "PAIRING CHECK FAILED" : "MX PATROL DEVICE SETUP",
      detail: input.deviceCompanyError ? "Network verification failed. Pairing code appears when the device can reach MX Patrol." : "This RG360 is not enrolled for patrol scanning.",
      tone: input.deviceCompanyError ? "warning" : "info",
    };
  }

  if (status === "maintenance" || input.deviceCompany.maintenanceExpiresAt) {
    return { kind: "maintenance", title: "MAINTENANCE MODE", detail: "Authorized maintenance session active. Patrol scanning is temporarily unavailable.", expiresAt: input.deviceCompany.maintenanceExpiresAt, tone: "info" };
  }

  if (status === "lock_device" || status === "locked") {
    return { kind: "locked", title: "MX PATROL DEVICE LOCKED", detail: "This device has been restricted by MX Patrol administration.", tone: "danger" };
  }

  if (status === "disabled" || status === "revoked") {
    return { kind: "disabled", title: "DEVICE DISABLED", detail: "This RG360 cannot record patrol scans.", tone: "danger" };
  }

  if (status === "update_required") {
    return { kind: "update_required", title: "UPDATE REQUIRED", detail: "Install the approved MX Patrol update before scanning.", tone: "warning" };
  }

  const blockedReason = getSecureDeviceBlockedReason({
    nativeState: input.secureNativeState,
    secureModeEnabled: input.deviceCompany.secureModeEnabled,
    secureModeStatus: status,
    pairingStatus,
    isNative: input.isNativeScanner,
  });

  if (blockedReason) {
    return { kind: status === "integrity_failed" ? "security_failed" : "security_failed", title: "DEVICE SECURITY CHECK FAILED", detail: blockedReason, tone: "danger" };
  }

  return { kind: "active", title: "ACTIVE", detail: "Scanner ready.", tone: "info" };
}

function restrictedStateToScannerStatus(kind: ScannerRestrictedKind): ScannerUiState {
  if (kind === "locked") return "locked";
  if (kind === "maintenance") return "maintenance";
  if (kind === "disabled") return "disabled_device";
  if (kind === "update_required") return "update_required";
  if (kind === "security_failed") return "security_failed";
  return "device_unassigned";
}

function getActivePatrolDisplay(structuredResult: StructuredScanResult | null, currentPatrol: CurrentPatrolRow | null): ActivePatrolDisplay {
  if (structuredResult?.patrol) {
    return {
      name: structuredResult.patrol.name ?? "Active patrol",
      completed: structuredResult.patrol.completed,
      required: structuredResult.patrol.required,
      progressPercent: Math.max(0, Math.min(100, structuredResult.patrol.progress_percent ?? 0)),
      nextCheckpoint: structuredResult.next_checkpoint?.name ?? null,
      status: structuredResult.patrol.status ?? null,
    };
  }

  if (!currentPatrol) return null;
  const route = Array.isArray(currentPatrol.patrol_routes) ? currentPatrol.patrol_routes[0] : currentPatrol.patrol_routes;
  const template = Array.isArray(currentPatrol.patrol_templates) ? currentPatrol.patrol_templates[0] : currentPatrol.patrol_templates;
  const checkpoints = [...(currentPatrol.patrol_session_checkpoints ?? [])].sort((a, b) => (a.scheduled_order ?? 9999) - (b.scheduled_order ?? 9999));
  const next = checkpoints.find((checkpoint) => !checkpoint.scanned_at && checkpoint.status !== "completed");
  const nextCheckpoint = next ? (Array.isArray(next.checkpoints) ? next.checkpoints[0]?.name : next.checkpoints?.name) : null;
  const completed = currentPatrol.checkpoint_completed ?? checkpoints.filter((checkpoint) => checkpoint.scanned_at || checkpoint.status === "completed").length;
  const required = currentPatrol.checkpoint_total ?? checkpoints.length;
  return {
    name: route?.name ?? template?.name ?? "Active patrol",
    completed,
    required,
    progressPercent: required ? Math.round((completed / required) * 100) : 0,
    nextCheckpoint: nextCheckpoint ?? null,
    status: currentPatrol.status,
  };
}

function formatMaintenanceCountdown(iso: string) {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "ending";
  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
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

const getScannerDisplayStatus = (input: { status: ScannerUiState; syncing: boolean; batteryLevel?: number | null; gpsStatus: "idle" | "capturing" | "available" | "pending" | "unavailable"; scannerBlocked: boolean; pendingDataLog: boolean; pendingFaceScan: boolean; }): ScannerUiState => {
  const passive = ["idle", "scanning", "initializing"].includes(input.status);
  if (input.syncing && !input.scannerBlocked && !input.pendingDataLog && !input.pendingFaceScan) return "syncing";
  if (passive && input.gpsStatus === "pending") return "gps_warning";
  if (passive && typeof input.batteryLevel === "number" && input.batteryLevel > 0 && input.batteryLevel <= 15) return "low_battery";
  return input.status;
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

























