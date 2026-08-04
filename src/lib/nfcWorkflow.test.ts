import { describe, expect, it, vi } from "vitest";
import { buildUnknownNfcTagAlertMessage, backfillNfcScanGps, reviewPendingNfcTag } from "@/lib/nfcWorkflow";

const { rpcCalls, tableCalls } = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tableCalls: [] as Array<{
    table: string;
    update: Record<string, unknown>;
    filters: Array<[string, unknown]>;
  }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: { status: args.p_decision }, error: null });
    },
    from: (table: string) => {
      const call = { table, update: {}, filters: [] as Array<[string, unknown]> };
      tableCalls.push(call);

      return {
        update: (payload: Record<string, unknown>) => {
          call.update = payload;
          return {
            eq: (column: string, value: unknown) => {
              call.filters.push([column, value]);
              return {
                eq: (nextColumn: string, nextValue: unknown) => {
                  call.filters.push([nextColumn, nextValue]);
                  return {
                    eq: (lastColumn: string, lastValue: unknown) => {
                      call.filters.push([lastColumn, lastValue]);
                      return Promise.resolve({ error: null });
                    },
                    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
                  };
                },
                then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
              };
            },
          };
        },
      };
    },
  },
}));

describe("reviewPendingNfcTag", () => {
  it("delegates the complete decision to the atomic database workflow", async () => {
    rpcCalls.length = 0;

    await reviewPendingNfcTag({
      pendingTagId: "pending-1",
      decision: "approved",
      checkpointName: "Main Gate",
    });

    expect(rpcCalls).toEqual([
      {
        name: "review_pending_nfc_tag",
        args: {
          p_pending_tag_id: "pending-1",
          p_decision: "approved",
          p_checkpoint_name: "Main Gate",
          p_rejection_reason: null,
        },
      },
    ]);
  });
});

describe("buildUnknownNfcTagAlertMessage", () => {
  it("includes the scanned tag, guard, timestamp, and GPS coordinates", () => {
    const message = buildUnknownNfcTagAlertMessage({
      tagId: "04AABBCCDD",
      guardName: "Alex Guard",
      scannedAt: "2026-06-10T08:15:00.000Z",
      gps: { lat: -26.2041, lng: 28.0473, accuracy: 12 },
    });

    expect(message).toContain("New NFC Tag Detected");
    expect(message).toContain("Tag UID: 04AABBCCDD");
    expect(message).toContain("Guard: Alex Guard");
    expect(message).toContain("GPS: -26.2041,28.0473");
    expect(message).toContain("Approve Registration | Ignore");
  });

  it("uses pending GPS and an unassigned guard fallback when scan context is incomplete", () => {
    const message = buildUnknownNfcTagAlertMessage({
      tagId: "UNKNOWN",
      guardName: null,
      scannedAt: "2026-06-10T08:15:00.000Z",
      gps: null,
    });

    expect(message).toContain("Guard: Unassigned");
    expect(message).toContain("GPS: Pending");
  });
});

describe("backfillNfcScanGps", () => {
  it("updates the exact scan log and the pending NFC tag row for that scan", async () => {
    tableCalls.length = 0;

    await backfillNfcScanGps({
      companyId: "company-1",
      scanLogId: "scan-1",
      tagId: "04AABBCCDD",
      gps: { lat: -26.2041, lng: 28.0473, accuracy: 12 },
    });

    expect(tableCalls).toEqual([
      {
        table: "scan_logs",
        update: { gps_lat: -26.2041, gps_lng: 28.0473, gps_accuracy: 12 },
        filters: [
          ["id", "scan-1"],
          ["company_id", "company-1"],
        ],
      },
      {
        table: "pending_nfc_tags",
        update: { gps_lat: -26.2041, gps_lng: 28.0473, gps_accuracy: 12 },
        filters: [
          ["company_id", "company-1"],
          ["tag_uid", "04aabbccdd"],
          ["scan_log_id", "scan-1"],
        ],
      },
    ]);
  });
});
