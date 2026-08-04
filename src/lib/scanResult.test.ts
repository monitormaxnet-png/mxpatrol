import { describe, expect, it } from "vitest";
import { normalizeNfcUid } from "@/lib/nfcUid";
import { describeScanResult, formatProgress, type StructuredScanResult } from "@/lib/scanResult";

const base: StructuredScanResult = {
  success: true,
  code: "CHECKPOINT_ACCEPTED",
  scan_id: "scan-1",
  checkpoint: { id: "cp-1", name: "Gate" },
  patrol: {
    session_id: "sess-1",
    schedule_id: "sched-1",
    name: "Tlokweng Gate Patrol",
    status: "active",
    completed: 1,
    required: 1,
    progress_percent: 100,
  },
  next_checkpoint: null,
  duplicate: false,
  offline_replay: false,
  message: "",
};

describe("normalizeNfcUid", () => {
  it("normalizes separators and case to one canonical value", () => {
    const expected = normalizeNfcUid("04a27f19886180");
    expect(normalizeNfcUid("04:A2:7F:19:88:61:80")).toBe(expected);
    expect(normalizeNfcUid("04-A2-7F-19-88-61-80")).toBe(expected);
    expect(normalizeNfcUid(" 04 A2 7F 19 88 61 80 ")).toBe(expected);
  });

  it("returns an empty string for missing or malformed UIDs", () => {
    expect(normalizeNfcUid(null)).toBe("");
    expect(normalizeNfcUid("   ")).toBe("");
    expect(normalizeNfcUid(":::")).toBe("");
  });
});

describe("formatProgress", () => {
  it("formats real accepted progress", () => {
    expect(formatProgress(base.patrol)).toBe("1 / 1 (100%)");
    expect(formatProgress({ ...base.patrol!, completed: 0, progress_percent: 0 })).toBe("0 / 1 (0%)");
  });

  it("returns null when there is no patrol", () => {
    expect(formatProgress(null)).toBeNull();
  });
});

describe("describeScanResult", () => {
  it("reports patrol completion for a one-checkpoint patrol", () => {
    const feedback = describeScanResult({ ...base, code: "PATROL_COMPLETED" });
    expect(feedback.uiState).toBe("patrol_completed");
    expect(feedback.tone).toBe("good");
    expect(feedback.detail).toContain("Tlokweng Gate Patrol");
  });

  it("reports automatic patrol start", () => {
    const feedback = describeScanResult({ ...base, code: "PATROL_STARTED" });
    expect(feedback.uiState).toBe("patrol_started");
  });

  it("reports duplicate scans without implying progress changed", () => {
    const feedback = describeScanResult({ ...base, code: "CHECKPOINT_ALREADY_SCANNED", duplicate: true });
    expect(feedback.uiState).toBe("duplicate");
    expect(feedback.detail).toContain("Progress unchanged");
  });

  it("records a checkpoint scan with no matching patrol", () => {
    const feedback = describeScanResult({ ...base, code: "NO_ACTIVE_PATROL", patrol: null });
    expect(feedback.uiState).toBe("no_active_patrol");
    expect(feedback.detail).toContain("No active patrol matched");
  });

  it("flags unregistered tags for supervisor review", () => {
    const feedback = describeScanResult({ ...base, code: "UNREGISTERED_CHECKPOINT", patrol: null, checkpoint: null });
    expect(feedback.uiState).toBe("unregistered");
    expect(feedback.detail).toContain("supervisor review");
  });

  it("flags out-of-order scans with the expected checkpoint", () => {
    const feedback = describeScanResult({
      ...base,
      code: "CHECKPOINT_OUT_OF_ORDER",
      next_checkpoint: { id: "cp-2", name: "Back Gate" },
    });
    expect(feedback.uiState).toBe("out_of_order");
    expect(feedback.detail).toContain("Back Gate");
  });

  it("shows offline saved and synced states", () => {
    expect(describeScanResult({ ...base, code: "OFFLINE_SAVED" }).uiState).toBe("success_offline");
    expect(describeScanResult({ ...base, code: "SYNCED" }).sound).toBe("sync-complete");
  });

  it("shows a non-enrolled device state", () => {
    expect(describeScanResult({ ...base, code: "DEVICE_NOT_ENROLLED" }).uiState).toBe("device_unassigned");
  });
});
