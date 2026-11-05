import { describe, expect, it } from "vitest";
import { normalizeNfcUid } from "@/lib/nfcUid";
import { commitBulkRegistration, normalizeBulkNfcUid, previewBulkRegistration } from "../../supabase/functions/_shared/bulk-registration";

const actor = { user_id: "user-1", company_id: "company-1", isPlatformOwner: true };
const checkpointRow = (rowNumber: number, uid: string) => ({
  sheet: "Checkpoints" as const,
  rowNumber,
  values: { "Checkpoint Name": "Gate", "NFC UID": uid, "Company Code": "CO", "Site Code": "SI" },
});

function clientFor(rows = [checkpointRow(2, "04:A1:B2")]) {
  const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
  const lookups: Array<{ kind: string; value: string }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "lookup_bulk_registration_identifier") {
        lookups.push({ kind: String(args.p_kind), value: String(args.p_value) });
        return { data: args.p_kind === "company_code" ? { id: "company-1" }
          : args.p_kind === "site_code" ? { id: "site-1" } : null, error: null };
      }
      if (name === "claim_bulk_registration_batch") return { data: { done: false, cursor: 0, claim_token: "claim-1", rows }, error: null };
      if (name === "complete_bulk_registration_batch") return { data: { done: true, results: args.p_results }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return table === "bulk_registration_jobs"
          ? { select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }
          : { error: null };
      },
      select: () => ({
        eq: () => ({ eq: () => ({ single: async () => ({ data: {
          id: "job-1", user_id: actor.user_id, company_id: actor.company_id,
          is_platform_owner: true, expires_at: "2099-01-01T00:00:00Z",
        }, error: null }) }) }),
      }),
    }),
  };
  return { client, inserted, lookups };
}

describe("bulk registration NFC identity", () => {
  it("uses the scanner's canonical UID for separator and case variants", () => {
    for (const uid of [" 04:A1:B2 ", "04A1B2", "04-a1.b2", "04 A1 B2"]) {
      expect(normalizeBulkNfcUid(uid)).toBe("04a1b2");
      expect(normalizeBulkNfcUid(uid)).toBe(normalizeNfcUid(uid));
    }
  });

  it("flags equivalent UIDs in the same workbook as duplicates", async () => {
    const { client } = clientFor();
    const result = await previewBulkRegistration(client, actor, [checkpointRow(2, "04:A1:B2"), checkpointRow(3, "04a1b2")]);
    expect(result.rows.map((row) => row.status)).toEqual(["ready", "conflicting"]);
  });

  it("looks up and stores the canonical UID during commit", async () => {
    const { client, inserted, lookups } = clientFor();
    await commitBulkRegistration(client, actor, "job-1");
    expect(lookups).toContainEqual({ kind: "checkpoint_nfc", value: "04a1b2" });
    expect(inserted.find((entry) => entry.table === "checkpoints")?.values.nfc_tag_id).toBe("04a1b2");
  });
});
