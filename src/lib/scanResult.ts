/**
 * Single source of truth for interpreting the authoritative scan result returned
 * by the `device-scan` Edge Function (which in turn calls the
 * `match_scan_to_patrol_session` RPC).
 */

export type ScanResultCode =
  | "PATROL_STARTED"
  | "CHECKPOINT_ACCEPTED"
  | "PATROL_COMPLETED"
  | "NO_ACTIVE_PATROL"
  | "CHECKPOINT_ALREADY_SCANNED"
  | "UNREGISTERED_CHECKPOINT"
  | "CHECKPOINT_OUT_OF_ORDER"
  | "CHECKPOINT_NOT_IN_ROUTE"
  | "OFFLINE_SAVED"
  | "SYNCED"
  | "DEVICE_NOT_ENROLLED"
  | "ERROR";

export type ScanPatrolInfo = {
  session_id: string | null;
  schedule_id: string | null;
  name: string | null;
  status: string | null;
  completed: number;
  required: number;
  progress_percent: number;
  selection_reason?: string | null;
};

export type StructuredScanResult = {
  success: boolean;
  code: ScanResultCode;
  scan_id: string | null;
  checkpoint: { id: string; name: string | null } | null;
  patrol: ScanPatrolInfo | null;
  next_checkpoint: { id: string; name: string | null } | null;
  duplicate: boolean;
  offline_replay: boolean;
  message: string;
};

export type ScanFeedbackTone = "good" | "info" | "warning" | "danger";

export type ScanFeedback = {
  /** Scanner UI state key consumed by ScannerRing. */
  uiState: string;
  tone: ScanFeedbackTone;
  title: string;
  detail: string;
  /** How long the feedback card stays before returning to ready-to-scan. */
  holdMs: number;
  sound: "scan-success" | "offline-queued" | "error" | "sync-complete";
};

export const formatProgress = (patrol: ScanPatrolInfo | null | undefined) => {
  if (!patrol || !patrol.required) return null;
  return `${patrol.completed} / ${patrol.required} (${Math.round(patrol.progress_percent)}%)`;
};

export const describeScanResult = (result: StructuredScanResult): ScanFeedback => {
  const checkpointName = result.checkpoint?.name ?? "Checkpoint";
  const patrolName = result.patrol?.name ?? "Scheduled patrol";
  const progress = formatProgress(result.patrol);
  const next = result.next_checkpoint?.name ? `Next: ${result.next_checkpoint.name}` : null;

  switch (result.code) {
    case "PATROL_STARTED":
      return {
        uiState: "patrol_started",
        tone: "good",
        title: "Patrol started",
        detail: [patrolName, checkpointName, progress, next].filter(Boolean).join(" · "),
        holdMs: 2600,
        sound: "scan-success",
      };
    case "CHECKPOINT_ACCEPTED":
      return {
        uiState: "success",
        tone: "good",
        title: "Checkpoint accepted",
        detail: [checkpointName, patrolName, progress, next].filter(Boolean).join(" · "),
        holdMs: 2200,
        sound: "scan-success",
      };
    case "PATROL_COMPLETED":
      return {
        uiState: "patrol_completed",
        tone: "good",
        title: "Patrol completed",
        detail: [patrolName, progress, new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })]
          .filter(Boolean)
          .join(" · "),
        holdMs: 3000,
        sound: "scan-success",
      };
    case "NO_ACTIVE_PATROL":
      return {
        uiState: "no_active_patrol",
        tone: "info",
        title: "Checkpoint recorded",
        detail: `${checkpointName} · No active patrol matched`,
        holdMs: 2600,
        sound: "scan-success",
      };
    case "CHECKPOINT_ALREADY_SCANNED":
      return {
        uiState: "duplicate",
        tone: "warning",
        title: "Already scanned",
        detail: [`${checkpointName} already counted`, progress ? `Progress unchanged ${progress}` : null]
          .filter(Boolean)
          .join(" · "),
        holdMs: 2400,
        sound: "error",
      };
    case "CHECKPOINT_OUT_OF_ORDER":
      return {
        uiState: "out_of_order",
        tone: "warning",
        title: "Out of order",
        detail: [`Scanned ${checkpointName}`, result.next_checkpoint?.name ? `Expected ${result.next_checkpoint.name}` : null]
          .filter(Boolean)
          .join(" · "),
        holdMs: 3000,
        sound: "error",
      };
    case "CHECKPOINT_NOT_IN_ROUTE":
      return {
        uiState: "no_active_patrol",
        tone: "info",
        title: "Checkpoint recorded",
        detail: `${checkpointName} is not part of the active route`,
        holdMs: 2600,
        sound: "scan-success",
      };
    case "UNREGISTERED_CHECKPOINT":
      return {
        uiState: "unregistered",
        tone: "danger",
        title: "Unregistered checkpoint",
        detail: "Submitted for supervisor review",
        holdMs: 3000,
        sound: "error",
      };
    case "OFFLINE_SAVED":
      return {
        uiState: "success_offline",
        tone: "warning",
        title: "Saved offline",
        detail: "Automatic synchronization pending",
        holdMs: 2600,
        sound: "offline-queued",
      };
    case "SYNCED":
      return {
        uiState: "success",
        tone: "good",
        title: "Synced",
        detail: "Queued scan synchronized successfully",
        holdMs: 2000,
        sound: "sync-complete",
      };
    case "DEVICE_NOT_ENROLLED":
      return {
        uiState: "device_unassigned",
        tone: "warning",
        title: "Device not enrolled",
        detail: "Contact a supervisor to enroll this device",
        holdMs: 3000,
        sound: "error",
      };
    default:
      return {
        uiState: "save_failed",
        tone: "danger",
        title: "Scan failed",
        detail: result.message || "MX Patrol will retry automatically where possible",
        holdMs: 3000,
        sound: "error",
      };
  }
};
