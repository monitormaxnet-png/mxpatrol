import { describe, expect, it } from "vitest";
import { normalizeNfcUid } from "@/lib/nfcUid";

describe("normalizeNfcUid", () => {
  it("normalizes NFC UIDs to lowercase hex without separators", () => {
    expect(normalizeNfcUid(" 04:AA:BB:CC:DD ")).toBe("04aabbccdd");
    expect(normalizeNfcUid("04-AA BB.CCDD")).toBe("04aabbccdd");
    expect(normalizeNfcUid("NFC-A001")).toBe("nfca001");
  });

  it("handles missing values as an empty UID", () => {
    expect(normalizeNfcUid(null)).toBe("");
    expect(normalizeNfcUid(undefined)).toBe("");
  });
});
