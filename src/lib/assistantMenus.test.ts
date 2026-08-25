import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MENUS,
  MANAGEMENT_HOME,
  USER_HOME,
  resolveAssistantInput,
  type RouterState,
} from "./assistantMenus";
import { describePatrol, patrolHeadline, patrolStatusCounts } from "./assistantPatrolFormat";

const userState = (menu = USER_HOME): RouterState => ({ mode: "user", activeMenu: menu, activeSiteId: "site-1" });
const mgmtState = (menu = MANAGEMENT_HOME): RouterState => ({ mode: "management", activeMenu: menu, activeSiteId: "site-1" });
const manager = { canManage: true };
const guard = { canManage: false };

describe("context-aware numeric menu routing", () => {
  it("management home 1 opens Operations", () => {
    const result = resolveAssistantInput(mgmtState(), "1", manager);
    expect(result).toMatchObject({ kind: "menu", menuKey: "management_operations" });
    expect(result.state.activeMenu).toBe("management_operations");
  });

  it("operations 2 opens the Patrol Status submenu", () => {
    expect(resolveAssistantInput(mgmtState("management_operations"), "2", manager)).toMatchObject({
      kind: "menu",
      menuKey: "management_patrol_status",
    });
  });

  it("operations 3 returns Missed Checkpoints", () => {
    expect(resolveAssistantInput(mgmtState("management_operations"), "3", manager)).toMatchObject({
      kind: "action",
      action: "missed_checkpoints",
    });
  });

  it("user home 5 opens Reports and 6 opens Patrol Status", () => {
    expect(resolveAssistantInput(userState(), "5", guard)).toMatchObject({ kind: "menu", menuKey: "user_reports" });
    expect(resolveAssistantInput(userState(), "6", guard)).toMatchObject({ kind: "menu", menuKey: "user_patrol_status" });
  });

  it("user home 7 returns missed checkpoints", () => {
    expect(resolveAssistantInput(userState(), "7", guard)).toMatchObject({ action: "missed_checkpoints" });
  });

  it("numeric meaning changes after submenu navigation", () => {
    const opened = resolveAssistantInput(mgmtState(), "1", manager);
    const before = resolveAssistantInput(mgmtState(), "2", manager);
    const after = resolveAssistantInput(opened.state, "2", manager);
    expect(before).toMatchObject({ kind: "menu", menuKey: "management_devices" });
    expect(after).toMatchObject({ kind: "menu", menuKey: "management_patrol_status" });
  });

  it("back returns to the parent menu", () => {
    const result = resolveAssistantInput(mgmtState("management_operations"), "back", manager);
    expect(result).toMatchObject({ kind: "menu", menuKey: MANAGEMENT_HOME });
  });

  it("menu returns to the current mode home", () => {
    expect(resolveAssistantInput(mgmtState("management_reports"), "menu", manager)).toMatchObject({ menuKey: MANAGEMENT_HOME });
    expect(resolveAssistantInput(userState("user_reports"), "menu", guard)).toMatchObject({ menuKey: USER_HOME });
  });

  it("cancel resets to mode home", () => {
    expect(resolveAssistantInput(userState("user_reports"), "cancel", guard)).toMatchObject({ menuKey: USER_HOME });
  });
});

describe("Patrol Status replaces the separate patrol outcome items", () => {
  it("removes the individual outcome items from the parent menus", () => {
    const removed = ["completed_patrols", "incomplete_patrols", "late_patrols", "missed_patrols"];
    for (const key of [USER_HOME, "management_operations"]) {
      const actions = ASSISTANT_MENUS[key].items.map((item) => item.action);
      for (const action of removed) expect(actions).not.toContain(action);
      expect(actions).toContain("menu:patrol_status");
    }
  });

  it("drills into each detailed status list from Patrol Status", () => {
    for (const state of [userState("user_patrol_status"), mgmtState("management_patrol_status")]) {
      const canManage = state.mode === "management" ? manager : guard;
      expect(resolveAssistantInput(state, "1", canManage)).toMatchObject({ action: "completed_patrols" });
      expect(resolveAssistantInput(state, "2", canManage)).toMatchObject({ action: "incomplete_patrols" });
      expect(resolveAssistantInput(state, "3", canManage)).toMatchObject({ action: "late_patrols" });
      expect(resolveAssistantInput(state, "4", canManage)).toMatchObject({ action: "missed_patrols" });
    }
  });

  it("back from Patrol Status returns to the correct parent menu", () => {
    expect(resolveAssistantInput(userState("user_patrol_status"), "5", guard)).toMatchObject({ kind: "menu", menuKey: USER_HOME });
    expect(resolveAssistantInput(mgmtState("management_patrol_status"), "5", manager)).toMatchObject({
      kind: "menu",
      menuKey: "management_operations",
    });
  });

  it("routes patrol status language to the Patrol Status screen in both modes", () => {
    expect(resolveAssistantInput(userState(), "patrol status", guard)).toMatchObject({ menuKey: "user_patrol_status" });
    expect(resolveAssistantInput(mgmtState("management_devices"), "show patrol status", manager)).toMatchObject({
      menuKey: "management_patrol_status",
    });
  });

  it("counts each outcome from the active-site session rows only", () => {
    const rows = [
      { status: "completed", site_id: "site-1" },
      { status: "completed_late", site_id: "site-1" },
      { status: "incomplete", site_id: "site-1" },
      { status: "late_start", site_id: "site-1" },
      { status: "missed", site_id: "site-1" },
      { status: "missed", site_id: "site-2" },
    ];
    const scoped = rows.filter((row) => row.site_id === "site-1");
    expect(patrolStatusCounts(scoped)).toEqual({ completed: 2, incomplete: 1, late: 2, missed: 1 });
    expect(patrolStatusCounts(rows.filter((row) => row.site_id === "site-2"))).toEqual({
      completed: 0,
      incomplete: 0,
      late: 0,
      missed: 1,
    });
  });
});

describe("permission-checked mode switching", () => {
  it("switches an authorized user into management mode only", () => {
    const result = resolveAssistantInput(userState(), "9", manager);
    expect(result.kind).toBe("menu");
    expect(result.state.mode).toBe("management");
    expect(result.state.activeMenu).toBe(MANAGEMENT_HOME);
  });

  it("denies management switching for unauthorized users", () => {
    const result = resolveAssistantInput(userState(), "9", guard);
    expect(result).toMatchObject({ kind: "denied" });
    expect(result.state.mode).toBe("user");
  });

  it("blocks management actions typed directly by unauthorized users", () => {
    expect(resolveAssistantInput(userState(), "lock device MX-021", guard)).toMatchObject({ kind: "denied" });
    expect(resolveAssistantInput(userState(), "generate report", guard)).toMatchObject({ kind: "denied" });
  });

  it("opens WhatsApp management from management home", () => {
    const result = resolveAssistantInput(mgmtState(), "7", manager);
    expect(result).toMatchObject({ kind: "menu", menuKey: "management_whatsapp" });
  });

  it("returns to the user assistant from management", () => {
    const result = resolveAssistantInput(mgmtState(), "10", manager);
    expect(result.state.mode).toBe("user");
    expect(result.state.activeMenu).toBe(USER_HOME);
  });
});

describe("natural language stays independent of numeric routing", () => {
  it("routes report language for both modes", () => {
    expect(resolveAssistantInput(userState(), "show yesterday's report", guard)).toMatchObject({ action: "report:yesterday" });
    expect(resolveAssistantInput(userState(), "show reports", guard)).toMatchObject({ kind: "menu", menuKey: "user_reports" });
    expect(resolveAssistantInput(mgmtState(), "show reports", manager)).toMatchObject({ kind: "menu", menuKey: "management_reports" });
    expect(resolveAssistantInput(mgmtState(), "generate patrol report", manager)).toMatchObject({ action: "generate_report" });
  });

  it("routes patrol outcomes directly to the detailed lists from any menu", () => {
    expect(resolveAssistantInput(mgmtState("management_devices"), "which checkpoints were missed?", manager)).toMatchObject({ action: "missed_checkpoints" });
    expect(resolveAssistantInput(userState("user_reports"), "show missed patrols", guard)).toMatchObject({ action: "missed_patrols" });
    expect(resolveAssistantInput(userState(), "show completed patrols", guard)).toMatchObject({ action: "completed_patrols" });
    expect(resolveAssistantInput(userState(), "late patrols", guard)).toMatchObject({ action: "late_patrols" });
    expect(resolveAssistantInput(userState(), "incomplete patrols", guard)).toMatchObject({ action: "incomplete_patrols" });
    expect(resolveAssistantInput(userState(), "which devices are offline", guard)).toMatchObject({ action: "devices_offline" });
  });

  it("keeps the active site across navigation", () => {
    const opened = resolveAssistantInput(mgmtState(), "1", manager);
    expect(opened.state.activeSiteId).toBe("site-1");
    expect(resolveAssistantInput(opened.state, "2", manager).state.activeSiteId).toBe("site-1");
  });
});

describe("patrol output includes canonical times", () => {
  const missed = {
    id: "s1",
    status: "missed",
    scheduled_start: "2026-08-24T04:00:00.000Z",
    scheduled_end: "2026-08-24T05:00:00.000Z",
    actual_start: null,
    checkpoint_completed: 0,
    checkpoint_total: 5,
    site_id: "site-1",
    patrol_name: "Night Patrol",
    site_name: "Airport Junction",
  };

  it("shows scheduled time, site and date for missed patrols", () => {
    const view = describePatrol(missed);
    expect(view.scheduledTime).toBe("06:00");
    expect(view.scheduledWindow).toBe("06:00 - 07:00");
    expect(view.site).toBe("Airport Junction");
    expect(view.date).toContain("2026");
    expect(view.status).toBe("missed");
    expect(patrolHeadline(missed)).toBe("06:00 — Missed — Night Patrol");
  });

  it("shows scheduled, actual and late-by for late patrols", () => {
    const view = describePatrol({ ...missed, status: "late_start", actual_start: "2026-08-24T04:25:00.000Z" });
    expect(view.scheduledTime).toBe("06:00");
    expect(view.actualStart).toBe("06:25");
    expect(view.lateBy).toBe("25 min");
  });

  it("shows completed vs expected checkpoints for incomplete patrols", () => {
    const view = describePatrol({ ...missed, status: "incomplete", checkpoint_completed: 3 });
    expect(view.checkpoints).toBe("3/5");
    expect(view.missedCheckpoints).toBe(2);
  });

  it("never invents times when the backend has none", () => {
    const view = describePatrol({ ...missed, scheduled_start: null, scheduled_end: null });
    expect(view.scheduledTime).toBe("Unknown");
    expect(view.scheduledWindow).toBeNull();
    expect(view.actualStart).toBeNull();
  });
});
