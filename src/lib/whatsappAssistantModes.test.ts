import { describe, expect, it } from "vitest";
import { keywordIntent } from "../../supabase/functions/whatsapp-webhook/lib/askmx";
import { mainMenu, managementMenu, secureDeviceMenu } from "../../supabase/functions/whatsapp-webhook/lib/views";
import { startFlow, startSecureDeviceAction } from "../../supabase/functions/whatsapp-webhook/lib/flows";
import { resolveIdentity } from "../../supabase/functions/whatsapp-webhook/lib/identity";
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
  canManageKiosk: false,
  canManageSecureDevices: false,
  platformRole: null,
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
  it("lands normal users directly in USER MODE with site-scoped operational choices", () => {
    const menu = mainMenu(baseIdentity, baseSession);
    expect(menu.title).toBe("USER MODE");
    expect(menu.lines.join("\n")).toContain("Site: Airport Junction");
    expect(menu.options?.map((option) => option.id)).toEqual([
      "patrol_status",
      "missed_checkpoints",
      "reports_data_logs",
      "report_incident",
      "reports",
      "back",
    ]);
  });

  it("offers mode selection with preserved site context for management identities", () => {
    const manager: Identity = { ...baseIdentity, role: "supervisor", canManage: true, canAcknowledge: true };
    const menu = mainMenu(manager, baseSession);
    expect(menu.title).toBe("MX PATROL");
    expect(menu.lines.join("\n")).toContain("Site: Airport Junction");
    expect(menu.options?.map((option) => option.id)).toEqual(["user", "management", "change_site", "help"]);
  });

  it("does not render management actions for normal users", () => {
    const menu = managementMenu(baseIdentity, baseSession);
    expect(menu.title).toBe("MANAGEMENT ACCESS UNAVAILABLE");
    expect(menu.options?.map((option) => option.id)).not.toContain("management_devices");
  });

  it("renders MANAGEMENT menu only for authorized management identities", () => {
    const identity: Identity = { ...baseIdentity, role: "supervisor", canManage: true, canAcknowledge: true };
    const menu = managementMenu(identity, { ...baseSession, last_menu: "management" });
    expect(menu.title).toBe("MANAGEMENT MODE");
    expect(menu.options?.map((option) => option.id)).toContain("management_devices");
    expect(menu.options?.map((option) => option.id)).toContain("management_checkpoints");
    expect(menu.options?.map((option) => option.id)).toContain("management_reports");
    expect(menu.options?.map((option) => option.id)).not.toContain("secure_devices");
  });

  it("exposes the secure devices entry from the devices submenu while keeping owner enforcement when it opens", () => {
    const manager: Identity = { ...baseIdentity, role: "admin", canManage: true, canAcknowledge: true };
    const owner: Identity = {
      ...manager,
      canManageKiosk: true,
      canManageSecureDevices: true,
      platformRole: "owner",
    };
    expect(WA_SUBMENUS.management_devices.options?.map((option) => option.id)).toContain("secure_devices");
    expect(secureDeviceMenu(manager, baseSession).title).toBe("OWNER ACCESS REQUIRED");
    expect(secureDeviceMenu(owner, baseSession).title).not.toBe("OWNER ACCESS REQUIRED");
    expect(secureDeviceMenu(owner, baseSession).options?.map((option) => option.id)).toContain("secure_action:request_enable_kiosk_mode");
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
    expect(keywordIntent("enable kiosk mode MX-021")).toEqual({ action: "secure_device_action", secureAction: "request_enable_kiosk_mode", device: "mx-021" });
    expect(keywordIntent("disable kiosk MX-021")).toEqual({ action: "secure_device_action", secureAction: "request_disable_kiosk_mode", device: "mx-021" });
  });
  it("maps role switching words without trusting message-provided role data", () => {
    expect(keywordIntent("management")).toEqual({ action: "management" });
    expect(keywordIntent("user")).toEqual({ action: "user" });
  });
});
describe("WhatsApp assistant secure device kiosk protection", () => {
  it("hides kiosk actions from company management identities unless they are platform operators", () => {
    const manager: Identity = { ...baseIdentity, role: "admin", canManage: true, canAcknowledge: true };
    const owner: Identity = { ...manager, canManageKiosk: true, canManageSecureDevices: true, platformRole: "owner" };
    expect(secureDeviceMenu(manager, baseSession).title).toBe("OWNER ACCESS REQUIRED");
    expect(secureDeviceMenu(owner, baseSession).options?.map((option) => option.id)).toContain("secure_action:request_enable_kiosk_mode");
    expect(secureDeviceMenu(owner, baseSession).options?.map((option) => option.id)).toContain("secure_action:request_disable_kiosk_mode");
  });

  it("rejects direct WhatsApp secure device commands from company admins", async () => {
    const manager: Identity = { ...baseIdentity, role: "admin", canManage: true, canAcknowledge: true };
    const result = await startSecureDeviceAction({} as never, manager, baseSession, "request_enable_kiosk_mode", "MX-021");
    expect(result.message.title).toBe("OWNER ACCESS REQUIRED");
    const lock = await startSecureDeviceAction({} as never, manager, baseSession, "request_device_lock", "MX-021");
    expect(lock.message.title).toBe("OWNER ACCESS REQUIRED");
  });
});

describe("WhatsApp assistant management write protection", () => {
  it("normal users cannot start management registration flows directly", async () => {
    const result = await startFlow({} as never, baseIdentity, baseSession, "REGISTER_DEVICE");
    expect(result.message.title).toBe("MANAGEMENT ACCESS UNAVAILABLE");
    expect(result.session).toBe(baseSession);
  });
});

describe("WhatsApp assistant management identity resolution", () => {
  function clientFor(row: Record<string, unknown>, userRoles: Array<{ role: string }> = []) {
    return {
      from(table: string) {
        if (table === "whatsapp_authorized_numbers") {
          return {
            select() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({ data: row }),
            update() { return { eq: () => ({}) }; },
          };
        }
        if (table === "user_roles") {
          return { select() { return this; }, eq() { return this; }, then: (resolve: (value: unknown) => unknown) => resolve({ data: userRoles }) };
        }
        if (table === "platform_admins") {
          return { select() { return this; }, eq() { return this; }, limit: async () => ({ data: [] }) };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
  }

  it("preserves management access from canonical WhatsApp authorization metadata when no live role row is available", async () => {
    const result = await resolveIdentity(clientFor({
      id: "auth-1",
      phone: "+27820000000",
      company_id: "company-1",
      user_id: "user-1",
      guard_id: null,
      display_name: "Ops Admin",
      allowed_site_ids: ["site-1"],
      status: "active",
      metadata: { access_type: "management", role: "admin" },
    }) as never, "+27820000000", "management");

    expect(result.kind).toBe("authorized");
    if (result.kind !== "authorized") return;
    expect(result.identity.role).toBe("admin");
    expect(result.identity.canManage).toBe(true);
  });

  it("does not elevate user-only WhatsApp authorizations from metadata", async () => {
    const result = await resolveIdentity(clientFor({
      id: "auth-2",
      phone: "+27820000001",
      company_id: "company-1",
      user_id: null,
      guard_id: "guard-1",
      display_name: "Guard User",
      allowed_site_ids: ["site-1"],
      status: "active",
      metadata: { access_type: "user", role: "admin" },
    }) as never, "+27820000001", "management");

    expect(result.kind).toBe("authorized");
    if (result.kind !== "authorized") return;
    expect(result.identity.role).toBe("guard");
    expect(result.identity.canManage).toBe(false);
  });
});
