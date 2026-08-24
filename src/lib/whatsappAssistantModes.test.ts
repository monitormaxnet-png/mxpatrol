import { describe, expect, it } from "vitest";
import { keywordIntent } from "../../supabase/functions/whatsapp-webhook/lib/askmx";
import { mainMenu, managementMenu, secureDeviceMenu } from "../../supabase/functions/whatsapp-webhook/lib/views";
import { startFlow } from "../../supabase/functions/whatsapp-webhook/lib/flows";
import type { Identity, SessionRow } from "../../supabase/functions/whatsapp-webhook/lib/types";

const baseIdentity: Identity = {
  id: "auth-1",
  phone: "+27820000000",
  company_id: "company-1",
  user_id: "user-1",
  guard_id: null,
  display_name: "Ops User",
  role: "guard",
  allowed_site_ids: ["site-1"],
  canSetup: false,
  canManage: false,
  canAcknowledge: false,
};

const baseSession: SessionRow = {
  id: "session-1",
  phone: "+27820000000",
  company_id: "company-1",
  user_id: "user-1",
  authorized_number_id: "auth-1",
  current_flow: null,
  current_step: null,
  temporary_data: {},
  current_site_id: "site-1",
  current_site_name: "Airport Junction",
  site_scope: "single",
  last_menu: "user",
};

describe("WhatsApp assistant role menus", () => {
  it("renders the USER menu with site-scoped operational choices", () => {
    const menu = mainMenu(baseIdentity, baseSession);
    expect(menu.title).toBe("MX PATROL");
    expect(menu.lines.join("\n")).toContain("Viewing: Airport Junction");
    expect(menu.options?.map((option) => option.id)).toEqual([
      "live",
      "attention",
      "devices",
      "incidents",
      "reports",
      "patrol_status",
      "missed_checkpoints",
      "change_site",
      "management",
    ]);
  });

  it("does not render management actions for normal users", () => {
    const menu = managementMenu(baseIdentity, baseSession);
    expect(menu.title).toBe("MANAGEMENT ACCESS UNAVAILABLE");
    expect(menu.options?.map((option) => option.id)).not.toContain("management_devices");
  });

  it("renders MANAGEMENT menu only for authorized management identities", () => {
    const identity: Identity = { ...baseIdentity, role: "supervisor", canManage: true, canAcknowledge: true };
    const menu = managementMenu(identity, { ...baseSession, last_menu: "management" });
    expect(menu.title).toContain("MANAGEMENT");
    expect(menu.options?.map((option) => option.id)).toContain("management_devices");
    expect(menu.options?.map((option) => option.id)).toContain("management_checkpoints");
    expect(menu.options?.map((option) => option.id)).toContain("management_incidents");
    expect(menu.options?.map((option) => option.id)).toContain("secure_devices");
  });
});

describe("WhatsApp assistant allowlisted intents", () => {
  it("maps natural language device status to a safe devices action", () => {
    expect(keywordIntent("Which devices are offline?")).toEqual({ action: "devices", filter: "offline" });
  });

  it("maps patrol outcome requests to canonical action names", () => {
    expect(keywordIntent("show completed patrols")).toEqual({ action: "completed_patrols" });
    expect(keywordIntent("show incomplete patrols")).toEqual({ action: "incomplete_patrols" });
    expect(keywordIntent("show late delayed patrols")).toEqual({ action: "late_patrols" });
    expect(keywordIntent("show missed patrols")).toEqual({ action: "missed_patrols" });
    expect(keywordIntent("which checkpoints were missed?")).toEqual({ action: "missed_checkpoints" });
  });


  it("maps secure-device language to management actions", () => {
    expect(keywordIntent("show devices with security problems")).toEqual({ action: "secure_device_problems" });
    expect(keywordIntent("lock device MX-021")).toEqual({ action: "secure_device_action", secureAction: "request_device_lock", device: "mx-021" });
    expect(keywordIntent("maintenance MX-043")).toEqual({ action: "secure_device_action", secureAction: "request_maintenance_mode", device: "mx-043" });
  });
  it("maps role switching words without trusting message-provided role data", () => {
    expect(keywordIntent("management")).toEqual({ action: "management" });
    expect(keywordIntent("user")).toEqual({ action: "user" });
  });
});
describe("WhatsApp assistant management write protection", () => {
  it("normal users cannot start management registration flows directly", async () => {
    const result = await startFlow({} as never, baseIdentity, baseSession, "REGISTER_DEVICE");
    expect(result.message.title).toBe("MANAGEMENT ACCESS UNAVAILABLE");
    expect(result.session).toBe(baseSession);
  });
});
