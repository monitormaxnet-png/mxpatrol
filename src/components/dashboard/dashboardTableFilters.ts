import { format } from "date-fns";
import type { FilterOption } from "./DashboardFilterBar";
import type { PatrolScanRow, PendingUnregisteredCheckpointRow } from "@/hooks/usePatrolScanData";

export const defaultDashboardFilters = {
  checkpoint: "all",
  device: "all",
  startDate: "",
  endDate: "",
  status: "all",
};

export function toFilterOptions(values: Array<string | null | undefined>): FilterOption[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))))
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}

export function isDateInRange(scannedAt: string, startDate: string, endDate: string) {
  const scanDate = format(new Date(scannedAt), "yyyy-MM-dd");
  return (!startDate || scanDate >= startDate) && (!endDate || scanDate <= endDate);
}

export function exportCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const escapeCell = (value: string | number | null | undefined) => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function scanStatus(scan: PatrolScanRow) {
  const rawStatus = scan.tag_status?.toLowerCase() ?? "";

  if (scan.is_offline_sync) return "Synced";
  if (rawStatus.includes("fail")) return "Failed";
  if (rawStatus === "unregistered" || rawStatus === "pending_registration") return "Unregistered";
  if (rawStatus === "rejected") return "Failed";
  if (scan.checkpoint_id) return "Registered";

  return formatStatus(scan.tag_status || "Unknown");
}

export function pendingCheckpointStatus(checkpoint: PendingUnregisteredCheckpointRow) {
  const rawStatus = checkpoint.tag_status?.toLowerCase() ?? "";

  if (rawStatus === "registered") return "Registered";
  if (rawStatus === "ignored" || rawStatus === "rejected") return "Ignored";
  if (rawStatus === "unregistered" || rawStatus === "pending_registration") return "Pending";

  return formatStatus(checkpoint.tag_status || "Pending");
}

export function formatStatus(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
