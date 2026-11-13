import { describe, it, expect } from "vitest";
import { isServiceRoleBearer } from "../../supabase/functions/_shared/whatsapp/serviceAuth";

describe("whatsapp-send service-role caller check", () => {
  const key = "service-key-abc";
  it("accepts the exact service-role bearer (device-scan path)", () => {
    expect(isServiceRoleBearer(`Bearer ${key}`, key)).toBe(true);
  });
  it("rejects a user JWT or other token so it falls through to admin/supervisor checks", () => {
    expect(isServiceRoleBearer("Bearer user.jwt.token", key)).toBe(false);
  });
  it("rejects missing header or missing key", () => {
    expect(isServiceRoleBearer("", key)).toBe(false);
    expect(isServiceRoleBearer(`Bearer ${key}`, "")).toBe(false);
  });
});
