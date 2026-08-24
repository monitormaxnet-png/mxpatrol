import type { OutMessage, SessionRow } from "./types.ts";

export const USER_HOME_KEY = "user_home";
export const MANAGEMENT_HOME_KEY = "management_home";

/**
 * Management submenus. Ids are the canonical action names handled by the webhook,
 * so a number typed inside a submenu can only ever resolve to that submenu's actions.
 */
export const WA_SUBMENUS: Record<string, OutMessage> = {
  management_operations: {
    title: "OPERATIONS",
    menuKey: "management_operations",
    lines: ["Choose an operations view."],
    options: [
      { id: "patrols", label: "Live Patrol" },
      { id: "patrol_status", label: "Patrol Status" },
      { id: "missed_checkpoints", label: "Missed Checkpoints" },
      { id: "back", label: "Back" },
    ],

  },
  management_devices: {
    title: "DEVICES",
    menuKey: "management_devices",
    lines: ["Choose a device management action."],
    options: [
      { id: "devices", label: "View Devices" },
      { id: "offline", label: "Offline Devices" },
      { id: "secure_device_status", label: "Device Security" },
      { id: "register_device", label: "Register Device" },
      { id: "back", label: "Back" },
    ],
  },
  management_checkpoints: {
    title: "CHECKPOINTS",
    menuKey: "management_checkpoints",
    lines: ["Choose a checkpoint management action."],
    options: [
      { id: "checkpoints", label: "View Checkpoints" },
      { id: "missed_checkpoints", label: "Missed Checkpoints" },
      { id: "add_checkpoint", label: "Register Checkpoint" },
      { id: "back", label: "Back" },
    ],
  },
  management_incidents: {
    title: "INCIDENTS",
    menuKey: "management_incidents",
    lines: ["Choose an incident management action."],
    options: [
      { id: "incidents", label: "Open Incidents" },
      { id: "report_incident", label: "Register Incident" },
      { id: "back", label: "Back" },
    ],
  },
  management_patrol_config: {
    title: "PATROL CONFIGURATION",
    menuKey: "management_patrol_config",
    lines: ["Choose a patrol configuration action."],
    options: [
      { id: "patrol_status", label: "View Patrol Status" },
      { id: "create_patrol", label: "Create Patrol" },
      { id: "back", label: "Back" },
    ],
  },
  management_reports: {
    title: "REPORTS",
    menuKey: "management_reports",
    lines: ["Choose a report."],
    options: [
      { id: "today", label: "Today Summary" },
      { id: "yesterday", label: "Yesterday Summary" },
      { id: "week", label: "This Week Summary" },
      { id: "problems", label: "Problems Only" },
      { id: "back", label: "Back" },
    ],
  },
};

export const WA_MENU_PARENTS: Record<string, string> = {
  management_operations: MANAGEMENT_HOME_KEY,
  management_devices: MANAGEMENT_HOME_KEY,
  management_checkpoints: MANAGEMENT_HOME_KEY,
  management_incidents: MANAGEMENT_HOME_KEY,
  management_patrol_config: MANAGEMENT_HOME_KEY,
  management_reports: MANAGEMENT_HOME_KEY,
  report_period: USER_HOME_KEY,
  [MANAGEMENT_HOME_KEY]: MANAGEMENT_HOME_KEY,
  [USER_HOME_KEY]: USER_HOME_KEY,
};

/** Maps numeric/keyword replies against the options we last showed, never against a different menu. */
export function resolveMenuChoice(session: SessionRow, input: string): string | null {
  const options = (session.temporary_data?.["last_options"] ?? []) as Array<{ id: string; label: string }>;
  if (!Array.isArray(options) || !options.length) return null;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    return index >= 1 && index <= options.length ? options[index - 1].id : null;
  }
  const lower = trimmed.toLowerCase().replace(/[^a-z0-9 /]/g, "").trim();
  const match = options.find((option) => option.label.toLowerCase().replace(/[^a-z0-9 /]/g, "").trim() === lower);
  return match?.id ?? null;
}

/** The menu we should return to when the user types `back`. */
export function backTarget(session: SessionRow): string {
  const current = String(session.temporary_data?.["last_menu_key"] ?? "");
  if (current === "patrol_status") {
    return session.last_menu === "management" ? "management_operations" : USER_HOME_KEY;
  }
  return WA_MENU_PARENTS[current] ?? (session.last_menu === "management" ? MANAGEMENT_HOME_KEY : USER_HOME_KEY);
}
