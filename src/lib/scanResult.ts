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
  | "CHECKPOINT_REQUIRES_DATA"
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

export type ScanDataLogField = {
  id: string;
  label: string;
  field_type: string;
  required: boolean;
  options: string[];
  sequence_order: number;
};

export type ScanDataLogForm = {
  id: string;
  name: string;
  form_type: string;
  fields: ScanDataLogField[];
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
  data_log_required?: boolean;
  data_log_form?: ScanDataLogForm | null;
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
  const scanTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const registeredDetail = [checkpointName, "Registered checkpoint", scanTime].join(" | ");

  switch (result.code) {
    case "PATROL_STARTED":
    case "CHECKPOINT_ACCEPTED":
    case "PATROL_COMPLETED":
      return { uiState: "success", tone: "good", title: "Scan successful", detail: registeredDetail, holdMs: 2200, sound: "scan-success" };
    case "NO_ACTIVE_PATROL":
      return { uiState: "no_active_patrol", tone: "info", title: "Scan recorded", detail: [checkpointName, "Registered checkpoint", "Not part of an active patrol"].join(" | "), holdMs: 2600, sound: "scan-success" };
    case "CHECKPOINT_ALREADY_SCANNED":
      return { uiState: "duplicate", tone: "warning", title: "Already scanned", detail: checkpointName, holdMs: 2400, sound: "error" };
    case "CHECKPOINT_OUT_OF_ORDER":
    case "CHECKPOINT_NOT_IN_ROUTE":
      return { uiState: "no_active_patrol", tone: "info", title: "Scan recorded", detail: [checkpointName, "Registered checkpoint", "Scan recorded for review"].join(" | "), holdMs: 2600, sound: "scan-success" };
    case "CHECKPOINT_REQUIRES_DATA":
      return { uiState: "awaiting_data", tone: "info", title: "Scan recorded", detail: result.data_log_form?.name ?? "Datalog", holdMs: 600000, sound: "scan-success" };
    case "UNREGISTERED_CHECKPOINT":
      return { uiState: "unregistered", tone: "danger", title: "Scan not successful", detail: "Checkpoint not registered | Scan recorded for review", holdMs: 3000, sound: "error" };
    case "OFFLINE_SAVED":
      return { uiState: "success_offline", tone: "warning", title: "Scan recorded", detail: "Saved offline | Sync pending", holdMs: 2600, sound: "offline-queued" };
    case "SYNCED":
      return { uiState: "success", tone: "good", title: "Scan recorded", detail: "Queued scan synchronized", holdMs: 2000, sound: "sync-complete" };
    case "DEVICE_NOT_ENROLLED":
      return { uiState: "device_unassigned", tone: "warning", title: "Scan not successful", detail: "Device not enrolled", holdMs: 3000, sound: "error" };
    default:
      return { uiState: "save_failed", tone: "danger", title: "Scan not successful", detail: result.message || "Scan could not be recorded", holdMs: 3000, sound: "error" };
  }
};
