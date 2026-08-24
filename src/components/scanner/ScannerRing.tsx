import { memo } from "react";
import { AlertTriangle, CheckCircle2, Cloud, HelpCircle, Loader2, Radio, ShieldAlert, WifiOff, XCircle } from "lucide-react";
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
  | "sos";

type GpsStatus = "idle" | "capturing" | "available" | "pending" | "unavailable";
type Tone = "ready" | "progress" | "success" | "offline" | "error" | "sos";

const statusConfig: Record<ScannerUiState, {
  label: string;
  sublabel: string;
  tone: Tone;
  icon: typeof Radio;
}> = {
  initializing: { label: "READY TO SCAN", sublabel: "Preparing scanner", tone: "ready", icon: Radio },
  idle: { label: "READY TO SCAN", sublabel: "Waiting for NFC tag", tone: "ready", icon: Radio },
  scanning: { label: "READY TO SCAN", sublabel: "Waiting for NFC tag", tone: "ready", icon: Radio },
  tag_detected: { label: "SCANNING", sublabel: "Reading NFC tag", tone: "success", icon: Radio },
  verifying: { label: "PROCESSING", sublabel: "Verifying checkpoint", tone: "progress", icon: Loader2 },
  acquiring_gps: { label: "PROCESSING", sublabel: "Capturing GPS", tone: "progress", icon: Loader2 },
  saving: { label: "PROCESSING", sublabel: "Saving scan record", tone: "progress", icon: Loader2 },
  success: { label: "CHECKPOINT VERIFIED", sublabel: "Scan saved", tone: "success", icon: CheckCircle2 },
  success_offline: { label: "SAVED OFFLINE", sublabel: "Sync pending", tone: "offline", icon: Cloud },
  offline_saved: { label: "SAVED OFFLINE", sublabel: "Stored locally", tone: "offline", icon: Cloud },
  duplicate: { label: "ALREADY SCANNED", sublabel: "Checkpoint already recorded", tone: "progress", icon: CheckCircle2 },
  unregistered: { label: "UNREGISTERED CHECKPOINT", sublabel: "Supervisor review required", tone: "error", icon: HelpCircle },
  save_failed: { label: "SCAN FAILED", sublabel: "Something went wrong", tone: "error", icon: XCircle },
  error: { label: "SCAN FAILED", sublabel: "Something went wrong", tone: "error", icon: XCircle },
  unsupported: { label: "NFC HARDWARE ERROR", sublabel: "Use the RG360 native app", tone: "offline", icon: WifiOff },
  disabled: { label: "NFC DISABLED", sublabel: "Enable NFC in device settings", tone: "offline", icon: WifiOff },
  device_unassigned: { label: "DEVICE NOT ASSIGNED", sublabel: "Contact supervisor", tone: "offline", icon: AlertTriangle },
  patrol_started: { label: "PATROL STARTED", sublabel: "Checkpoint accepted", tone: "success", icon: CheckCircle2 },
  patrol_completed: { label: "PATROL COMPLETED", sublabel: "All required checkpoints scanned", tone: "success", icon: CheckCircle2 },
  no_active_patrol: { label: "CHECKPOINT RECORDED", sublabel: "No active patrol matched", tone: "progress", icon: CheckCircle2 },
  out_of_order: { label: "OUT OF ORDER", sublabel: "Follow the route order", tone: "offline", icon: AlertTriangle },
  awaiting_data: { label: "DATA LOG REQUIRED", sublabel: "Complete the form to finish this checkpoint", tone: "progress", icon: Loader2 },
  sos: { label: "SOS ACTIVATED", sublabel: "Alert sent to control room", tone: "sos", icon: ShieldAlert },
};

const toneClasses: Record<Tone, {
  panel: string;
  icon: string;
  title: string;
}> = {
  ready: {
    panel: "border-emerald-300/28 bg-black/64 shadow-[0_0_34px_rgba(34,197,94,0.22)]",
    icon: "bg-emerald-400/12 text-emerald-100 ring-emerald-300/45",
    title: "text-emerald-100",
  },
  progress: {
    panel: "border-sky-300/35 bg-black/68 shadow-[0_0_30px_rgba(14,165,233,0.24)]",
    icon: "bg-sky-400/14 text-sky-100 ring-sky-300/45",
    title: "text-sky-100",
  },
  success: {
    panel: "border-emerald-300/40 bg-black/68 shadow-[0_0_30px_rgba(34,197,94,0.26)]",
    icon: "bg-emerald-400/16 text-emerald-100 ring-emerald-300/50",
    title: "text-emerald-100",
  },
  offline: {
    panel: "border-amber-300/42 bg-black/70 shadow-[0_0_30px_rgba(245,158,11,0.24)]",
    icon: "bg-amber-400/16 text-amber-100 ring-amber-300/50",
    title: "text-amber-100",
  },
  error: {
    panel: "border-red-300/45 bg-black/72 shadow-[0_0_32px_rgba(239,68,68,0.28)]",
    icon: "bg-red-500/16 text-red-100 ring-red-300/50",
    title: "text-red-100",
  },
  sos: {
    panel: "border-red-300/70 bg-red-950/86 shadow-[0_0_58px_rgba(239,68,68,0.55)]",
    icon: "bg-red-500/24 text-red-50 ring-red-200/70",
    title: "text-red-50",
  },
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
}: ScannerRingProps) => {
  const unknownTag = status === "unregistered" || (status === "error" && /not registered|unregistered/i.test(errorReason ?? ""));
  const effectiveStatus: ScannerUiState = unknownTag ? "unregistered" : status === "error" ? "save_failed" : status;
  const config = statusConfig[effectiveStatus];
  const tone = toneClasses[config.tone];
  const Icon = config.icon;
  const message = getEventMessage(effectiveStatus, checkpointName, errorReason, gpsStatus, pendingCount);
  const scanTime = scannedAt ? new Date(scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const isBusy = effectiveStatus === "saving" || effectiveStatus === "verifying" || effectiveStatus === "acquiring_gps";
  const isSos = effectiveStatus === "sos";
  const progress = structuredResult?.patrol ?? null;
  const progressPercent = Math.max(0, Math.min(100, progress?.progress_percent ?? 0));
  const checkpointLabel = checkpointName ?? structuredResult?.checkpoint?.name ?? structuredResult?.next_checkpoint?.name ?? null;
  const routeHint = effectiveStatus === "out_of_order" && structuredResult?.next_checkpoint?.name
    ? `Expected ${structuredResult.next_checkpoint.name}`
    : null;

  return (
    <section
      className={`scanner-feedback-card pointer-events-auto w-full max-w-[19rem] rounded-2xl border px-4 py-4 text-center text-white backdrop-blur-[3px] ${tone.panel} ${isSos ? "scanner-sos-overlay" : ""}`}
      aria-live={isSos ? "assertive" : "polite"}
    >
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-1 ${tone.icon} ${isSos ? "scanner-sos-pulse" : ""}`}>
        <Icon className={`h-8 w-8 ${isBusy ? "animate-spin" : effectiveStatus === "tag_detected" || effectiveStatus === "scanning" ? "animate-pulse" : ""}`} />
      </div>
      <p className={`mt-3 text-lg font-black uppercase leading-tight tracking-[0.08em] ${tone.title}`}>{config.label}</p>
      <p className="mt-1 text-sm font-semibold text-white/88">{config.sublabel}</p>
      <p className="mt-2 text-xs font-medium text-white/68">{routeHint ?? message}</p>

      {progress && (
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/72 p-3 text-left">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-200">{progress.name ?? "Active patrol"}</p>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
            <span className="text-xs text-white/60">Checkpoint</span>
            <span className="min-w-0 truncate text-right text-sm font-bold text-white">{checkpointLabel ?? "Checkpoint"}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-white/60">Progress</span>
            <span className="text-sm font-bold text-white">
              {progress.completed} / {progress.required} ({Math.round(progressPercent)}%)
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}

      {(checkpointLabel || tagUid || scanTime || deviceIdentifier) && (
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/60">
          {checkpointLabel && <span>{checkpointLabel}</span>}
          {tagUid && !checkpointLabel && <span>{tagUid}</span>}
          {scanTime && <span>{scanTime}</span>}
          {deviceIdentifier && <span>{deviceIdentifier}</span>}
        </div>
      )}
      {isOnline === false && <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-200">Offline</p>}
    </section>
  );
};

const getEventMessage = (
  status: ScannerUiState,
  checkpointName: string | null | undefined,
  errorReason: string | null | undefined,
  gpsStatus: GpsStatus,
  pendingCount: number,
) => {
  if (status === "success") {
    const gps = gpsStatus === "available" ? "GPS verified" : "GPS will update if available";
    return `${checkpointName || "Checkpoint"} - ${gps}`;
  }
  if (status === "success_offline" || status === "offline_saved") return `${pendingCount} pending - will sync automatically`;
  if (status === "duplicate") return checkpointName ? `${checkpointName} already recorded` : "Previous scan already exists";
  if (status === "unregistered") return "Supervisor registration required";
  if (status === "device_unassigned") return "This RG360 must be assigned before scanning";
  if (status === "sos") return "Location transmitting";
  if (status === "tag_detected") return "Reading tag...";
  if (status === "verifying" || status === "acquiring_gps") return "Matching checkpoint to patrol";
  if (status === "saving") return "Writing scan log";
  if (status === "scanning" || status === "idle" || status === "initializing") return "Hold your device near the checkpoint tag";
  if (status === "patrol_started") return "Patrol auto-started by first checkpoint";
  if (status === "patrol_completed") return "All required checkpoints completed";
  if (status === "no_active_patrol") return "Checkpoint recorded, no active patrol matched";
  if (status === "out_of_order") return "Please scan the expected checkpoint first";
  if ((status === "save_failed" || status === "error") && errorReason) return guardSafeReason(errorReason);
  return "Retrying automatically";
};

const guardSafeReason = (reason: string) => {
  if (/saved locally|sync is queued/i.test(reason)) return "Saved offline. Will sync automatically.";
  if (/duplicate/i.test(reason)) return "This checkpoint was already scanned recently.";
  if (/not registered|unregistered/i.test(reason)) return "Supervisor registration required.";
  if (/company|enroll|assigned|paired/i.test(reason)) return "Device is not assigned for patrol scanning.";
  if (/gps/i.test(reason)) return "GPS unavailable, scan saved without GPS.";
  return "Retrying automatically.";
};

export default memo(ScannerRing);