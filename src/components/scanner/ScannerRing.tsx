import { memo } from "react";
import { AlertTriangle, Check, Cloud, HelpCircle, Loader2, Lock, Radio, ShieldAlert, WifiOff, Wrench, X } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";
import type { StructuredScanResult } from "@/lib/scanResult";

export type ScannerUiState =
  | NfcStatus
  | "initializing"
  | "tag_detected"
  | "verifying"
  | "acquiring_gps"
  | "unregistered"
  | "success_offline"
  | "offline_saved"
  | "duplicate"
  | "save_failed"
  | "device_unassigned"
  | "patrol_started"
  | "patrol_completed"
  | "no_active_patrol"
  | "out_of_order"
  | "awaiting_data"
  | "locked"
  | "maintenance"
  | "disabled_device"
  | "update_required"
  | "security_failed"
  | "sos";

type GpsStatus = "idle" | "capturing" | "available" | "pending" | "unavailable";
type Tone = "ready" | "progress" | "success" | "warning" | "offline" | "error" | "sos";

type ActivePatrolSummary = {
  name: string;
  completed: number;
  required: number;
  progressPercent: number;
  nextCheckpoint: string | null;
  status?: string | null;
};

const statusConfig: Record<ScannerUiState, { label: string; sublabel: string; tone: Tone; icon: typeof Radio }> = {
  initializing: { label: "NFC", sublabel: "PREPARING SCANNER", tone: "ready", icon: Radio },
  idle: { label: "NFC", sublabel: "HOLD DEVICE NEAR CHECKPOINT TAG", tone: "ready", icon: Radio },
  scanning: { label: "NFC", sublabel: "HOLD DEVICE NEAR CHECKPOINT TAG", tone: "ready", icon: Radio },
  tag_detected: { label: "READING TAG...", sublabel: "PLEASE HOLD STEADY", tone: "progress", icon: Radio },
  verifying: { label: "READING TAG...", sublabel: "VERIFYING CHECKPOINT", tone: "progress", icon: Loader2 },
  acquiring_gps: { label: "READING TAG...", sublabel: "CHECKING GPS", tone: "progress", icon: Loader2 },
  saving: { label: "READING TAG...", sublabel: "RECORDING SCAN", tone: "progress", icon: Loader2 },
  success: { label: "CHECKPOINT VERIFIED", sublabel: "SCAN RECORDED", tone: "success", icon: Check },
  patrol_started: { label: "CHECKPOINT VERIFIED", sublabel: "PATROL STARTED", tone: "success", icon: Check },
  patrol_completed: { label: "CHECKPOINT COMPLETE", sublabel: "PATROL COMPLETE", tone: "success", icon: Check },
  no_active_patrol: { label: "CHECKPOINT VERIFIED", sublabel: "NO ACTIVE PATROL MATCHED", tone: "success", icon: Check },
  awaiting_data: { label: "CHECKPOINT VERIFIED", sublabel: "DATA LOG REQUIRED", tone: "success", icon: Check },
  success_offline: { label: "OFFLINE MODE", sublabel: "SCAN SAVED SECURELY", tone: "offline", icon: Cloud },
  offline_saved: { label: "OFFLINE MODE", sublabel: "SYNC WHEN CONNECTION RETURNS", tone: "offline", icon: Cloud },
  duplicate: { label: "ALREADY SCANNED", sublabel: "CHECKPOINT ALREADY RECORDED", tone: "warning", icon: AlertTriangle },
  out_of_order: { label: "WRONG CHECKPOINT", sublabel: "FOLLOW ROUTE ORDER", tone: "error", icon: X },
  unregistered: { label: "UNREGISTERED TAG", sublabel: "NOT ASSIGNED TO A CHECKPOINT", tone: "error", icon: X },
  save_failed: { label: "GPS CHECK FAILED", sublabel: "SCAN NOT COMPLETED", tone: "warning", icon: AlertTriangle },
  error: { label: "ERROR / ALERT", sublabel: "SCAN NOT COMPLETED", tone: "error", icon: X },
  unsupported: { label: "NFC UNAVAILABLE", sublabel: "USE APPROVED RG360 APP", tone: "offline", icon: WifiOff },
  disabled: { label: "NFC DISABLED", sublabel: "ENABLE NFC TO SCAN", tone: "offline", icon: WifiOff },
  device_unassigned: { label: "DEVICE SETUP", sublabel: "PAIRING REQUIRED", tone: "warning", icon: HelpCircle },
  locked: { label: "DEVICE LOCKED", sublabel: "SCANNING BLOCKED", tone: "error", icon: Lock },
  maintenance: { label: "MAINTENANCE MODE", sublabel: "SCANNING TEMPORARILY UNAVAILABLE", tone: "progress", icon: Wrench },
  disabled_device: { label: "DEVICE DISABLED", sublabel: "CONTACT ADMINISTRATION", tone: "error", icon: Lock },
  update_required: { label: "UPDATE REQUIRED", sublabel: "INSTALL APPROVED APP UPDATE", tone: "warning", icon: AlertTriangle },
  security_failed: { label: "SECURITY CHECK FAILED", sublabel: "ADMINISTRATOR ATTENTION REQUIRED", tone: "error", icon: ShieldAlert },
  sos: { label: "SOS ACTIVATED", sublabel: "EMERGENCY ALERT SENT", tone: "sos", icon: ShieldAlert },
};

interface ScannerRingProps {
  status: ScannerUiState;
  checkpointName?: string | null;
  errorReason?: string | null;
  tagUid?: string | null;
  gpsStatus?: GpsStatus;
  isOnline?: boolean;
  pendingCount?: number;
  scannedAt?: string | null;
  structuredResult?: StructuredScanResult | null;
  deviceIdentifier?: string | null;
  activePatrol?: ActivePatrolSummary | null;
  feedbackTitle?: string;
  feedbackDetail?: string;
}

const ScannerRing = ({
  status,
  checkpointName,
  errorReason,
  tagUid,
  gpsStatus = "idle",
  isOnline,
  pendingCount = 0,
  scannedAt,
  structuredResult,
  deviceIdentifier,
  activePatrol,
  feedbackTitle,
  feedbackDetail,
}: ScannerRingProps) => {
  const unknownTag = status === "unregistered" || (status === "error" && /not registered|unregistered/i.test(errorReason ?? ""));
  const gpsFailure = status === "save_failed" && /gps|location/i.test(errorReason ?? "");
  const effectiveStatus: ScannerUiState = unknownTag ? "unregistered" : status === "error" ? "save_failed" : gpsFailure ? "save_failed" : status;
  const config = statusConfig[effectiveStatus];
  const Icon = config.icon;
  const isBusy = ["tag_detected", "verifying", "acquiring_gps", "saving"].includes(effectiveStatus);
  const isSos = effectiveStatus === "sos";
  const progress = activePatrol ?? getStructuredPatrol(structuredResult);
  const progressPercent = Math.max(0, Math.min(100, progress?.progressPercent ?? 0));
  const checkpointLabel = checkpointName ?? structuredResult?.checkpoint?.name ?? structuredResult?.next_checkpoint?.name ?? null;
  const nextCheckpoint = structuredResult?.next_checkpoint?.name ?? progress?.nextCheckpoint ?? null;
  const scanTime = scannedAt ? new Date(scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <section className={`rg360-ring-stage rg360-tone-${config.tone}`} aria-live={isSos ? "assertive" : "polite"}>
      <div className={`rg360-ring ${isBusy ? "is-reading" : ""} ${isSos ? "is-sos" : ""}`}>
        <div className="rg360-ring-core">
          <div className="rg360-ring-icon">
            <Icon className={isBusy ? "h-12 w-12 animate-pulse" : "h-12 w-12"} />
          </div>
          <h1>{config.label}</h1>
          <p>{config.sublabel}</p>
          {checkpointLabel ? <strong>{checkpointLabel}</strong> : null}
        </div>
      </div>

      <div className="rg360-result-card">
        <p>{feedbackTitle ?? getEventTitle(effectiveStatus)}</p>
        <span>{getEventMessage(effectiveStatus, checkpointLabel, errorReason, gpsStatus, pendingCount, feedbackDetail)}</span>
        {effectiveStatus === "out_of_order" && nextCheckpoint ? <em>Expected: {nextCheckpoint}</em> : null}
        {effectiveStatus === "unregistered" && tagUid ? <em>Tag: {tagUid}</em> : null}
        {progress ? (
          <div className="rg360-result-progress">
            <div><span>Progress</span><strong>{progress.completed} / {progress.required}</strong></div>
            <div className="rg360-progress"><span style={{ width: `${progressPercent}%` }} /></div>
          </div>
        ) : null}
        {(scanTime || deviceIdentifier || isOnline === false) ? (
          <small>{scanTime ?? "--:--"} {deviceIdentifier ? `- ${deviceIdentifier}` : ""} {isOnline === false ? "- OFFLINE" : ""}</small>
        ) : null}
      </div>
    </section>
  );
};

function getStructuredPatrol(result: StructuredScanResult | null): ActivePatrolSummary | null {
  if (!result?.patrol) return null;
  return {
    name: result.patrol.name ?? "Active patrol",
    completed: result.patrol.completed,
    required: result.patrol.required,
    progressPercent: result.patrol.progress_percent ?? 0,
    nextCheckpoint: result.next_checkpoint?.name ?? null,
    status: result.patrol.status ?? null,
  };
}

function getEventTitle(status: ScannerUiState) {
  if (status === "awaiting_data") return "Scan recorded";
  if (status === "duplicate") return "Already scanned";
  if (status === "success_offline" || status === "offline_saved") return "Offline scan saved";
  if (status === "sos") return "SOS active";
  return statusConfig[status].label;
}

function getEventMessage(status: ScannerUiState, checkpointName: string | null, errorReason: string | null, gpsStatus: GpsStatus, pendingCount: number, fallback?: string) {
  if (fallback) return fallback;
  if (status === "success" || status === "patrol_started" || status === "patrol_completed" || status === "no_active_patrol") return checkpointName ? `${checkpointName} recorded.` : "Checkpoint scan recorded.";
  if (status === "awaiting_data") return "Open the data log and complete all required fields.";
  if (status === "duplicate") return checkpointName ? `${checkpointName} was already recorded for this patrol.` : "This checkpoint was already recorded for the current patrol.";
  if (status === "out_of_order") return errorReason ?? "This route must be scanned in sequence.";
  if (status === "unregistered") return errorReason ?? "This NFC tag is not assigned to a checkpoint.";
  if (status === "save_failed") return errorReason ?? (gpsStatus === "unavailable" ? "Location could not be verified." : "Checkpoint scan could not be completed.");
  if (status === "success_offline" || status === "offline_saved") return pendingCount ? `${pendingCount} scan${pendingCount === 1 ? "" : "s"} waiting to sync.` : "Will sync automatically when connection returns.";
  if (status === "sos") return "Emergency alert sent to command center.";
  return checkpointName ?? "Hold device near checkpoint tag.";
}

export default memo(ScannerRing);