import { memo } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Loader2, Radio, ShieldAlert, WifiOff, XCircle } from "lucide-react";
import type { NfcStatus } from "@/hooks/useNfcReader";

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
  | "sos";

type GpsStatus = "idle" | "capturing" | "available" | "pending" | "unavailable";
type Tone = "progress" | "success" | "offline" | "error" | "sos";

const idleStates = new Set<ScannerUiState>(["initializing", "idle", "scanning"]);

const statusConfig: Record<ScannerUiState, {
  label: string;
  sublabel: string;
  tone: Tone;
  icon: typeof Radio;
}> = {
  initializing: { label: "", sublabel: "", tone: "progress", icon: Radio },
  idle: { label: "", sublabel: "", tone: "progress", icon: Radio },
  scanning: { label: "", sublabel: "", tone: "progress", icon: Radio },
  tag_detected: { label: "TAG DETECTED", sublabel: "Hold steady", tone: "success", icon: Radio },
  verifying: { label: "VERIFYING CHECKPOINT", sublabel: "Please wait", tone: "progress", icon: Loader2 },
  acquiring_gps: { label: "VERIFYING CHECKPOINT", sublabel: "Checking location", tone: "progress", icon: Loader2 },
  saving: { label: "VERIFYING CHECKPOINT", sublabel: "Saving scan", tone: "progress", icon: Loader2 },
  success: { label: "CHECKPOINT VERIFIED", sublabel: "Scan saved", tone: "success", icon: CheckCircle2 },
  success_offline: { label: "CHECKPOINT VERIFIED", sublabel: "Sync pending", tone: "offline", icon: Cloud },
  offline_saved: { label: "CHECKPOINT VERIFIED", sublabel: "Saved securely on device", tone: "offline", icon: Cloud },
  duplicate: { label: "CHECKPOINT ALREADY SCANNED", sublabel: "Previous scan detected", tone: "offline", icon: AlertTriangle },
  unregistered: { label: "UNKNOWN CHECKPOINT", sublabel: "Tag not registered", tone: "error", icon: AlertTriangle },
  save_failed: { label: "SCAN SAVE DELAYED", sublabel: "Retrying automatically", tone: "error", icon: XCircle },
  error: { label: "SCAN SAVE DELAYED", sublabel: "Retrying automatically", tone: "error", icon: XCircle },
  unsupported: { label: "NFC HARDWARE ERROR", sublabel: "Use the RG360 native app", tone: "offline", icon: WifiOff },
  disabled: { label: "NFC DISABLED", sublabel: "Enable NFC in device settings", tone: "offline", icon: WifiOff },
  device_unassigned: { label: "DEVICE NOT ASSIGNED", sublabel: "Contact supervisor", tone: "offline", icon: AlertTriangle },
  patrol_started: { label: "PATROL STARTED", sublabel: "Checkpoint accepted", tone: "success", icon: CheckCircle2 },
  patrol_completed: { label: "PATROL COMPLETED", sublabel: "All required checkpoints scanned", tone: "success", icon: CheckCircle2 },
  no_active_patrol: { label: "CHECKPOINT RECORDED", sublabel: "No active patrol matched", tone: "progress", icon: CheckCircle2 },
  out_of_order: { label: "OUT OF ORDER", sublabel: "Follow the route order", tone: "offline", icon: AlertTriangle },
  sos: { label: "SOS ACTIVATED", sublabel: "Alert sent to control room", tone: "sos", icon: ShieldAlert },
};

const toneClasses: Record<Tone, {
  panel: string;
  icon: string;
  title: string;
}> = {
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
}

const ScannerRing = ({
  status,
  checkpointName,
  errorReason,
  tagUid,
  gpsStatus = "idle",
  pendingCount = 0,
  scannedAt,
}: ScannerRingProps) => {
  if (idleStates.has(status)) {
    return <span className="sr-only" aria-live="polite">NFC scanner ready</span>;
  }

  const unknownTag = status === "unregistered" || (status === "error" && /not registered|unregistered/i.test(errorReason ?? ""));
  const effectiveStatus: ScannerUiState = unknownTag ? "unregistered" : status === "error" ? "save_failed" : status;
  const config = statusConfig[effectiveStatus];
  const tone = toneClasses[config.tone];
  const Icon = config.icon;
  const message = getEventMessage(effectiveStatus, checkpointName, errorReason, gpsStatus, pendingCount);
  const scanTime = scannedAt ? new Date(scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const isBusy = effectiveStatus === "saving" || effectiveStatus === "verifying" || effectiveStatus === "acquiring_gps";
  const isSos = effectiveStatus === "sos";

  return (
    <section
      className={`scanner-feedback-card pointer-events-auto w-full max-w-[19rem] rounded-2xl border px-4 py-4 text-center text-white backdrop-blur-[3px] ${tone.panel} ${isSos ? "scanner-sos-overlay" : ""}`}
      aria-live={isSos ? "assertive" : "polite"}
    >
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-1 ${tone.icon} ${isSos ? "scanner-sos-pulse" : ""}`}>
        <Icon className={`h-8 w-8 ${isBusy ? "animate-spin" : effectiveStatus === "tag_detected" ? "animate-pulse" : ""}`} />
      </div>
      <p className={`mt-3 text-lg font-black uppercase leading-tight tracking-[0.08em] ${tone.title}`}>{config.label}</p>
      <p className="mt-1 text-sm font-semibold text-white/88">{config.sublabel}</p>
      <p className="mt-2 text-xs font-medium text-white/68">{message}</p>
      {(checkpointName || tagUid || scanTime) && (
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/60">
          {checkpointName && <span>{checkpointName}</span>}
          {tagUid && !checkpointName && <span>{tagUid}</span>}
          {scanTime && <span>{scanTime}</span>}
        </div>
      )}
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
  if (status === "tag_detected") return "Hold steady";
  if (status === "verifying" || status === "acquiring_gps") return "Checking tag, checkpoint, and GPS";
  if (status === "saving") return "Please wait";
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