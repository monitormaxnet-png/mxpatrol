import { describe, expect, it } from "vitest";
import {
  MANAGEMENT_HOME,
  USER_HOME,
  resolveAssistantInput,
  type RouterState,
} from "./assistantMenus";
import { describePatrol, patrolHeadline } from "./assistantPatrolFormat";

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

  it("operations 6 returns Missed Patrols, not root Reports", () => {
    const result = resolveAssistantInput(mgmtState("management_operations"), "6", manager);
    expect(result).toMatchObject({ kind: "action", action: "missed_patrols" });
  });

  it("operations 7 returns Missed Checkpoints", () => {
    expect(resolveAssistantInput(mgmtState("management_operations"), "7", manager)).toMatchObject({
      kind: "action",
      action: "missed_checkpoints",
    });
  });

  it("user home 5 opens Reports", () => {
    expect(resolveAssistantInput(userState(), "5", guard)).toMatchObject({ kind: "menu", menuKey: "user_reports" });
  });

  it("user home 9 returns missed patrols and 10 missed checkpoints", () => {
    expect(resolveAssistantInput(userState(), "9", guard)).toMatchObject({ action: "missed_patrols" });
    expect(resolveAssistantInput(userState(), "10", guard)).toMatchObject({ action: "missed_checkpoints" });
  });

  it("numeric meaning changes after submenu navigation", () => {
    const opened = resolveAssistantInput(mgmtState(), "1", manager);
    const before = resolveAssistantInput(mgmtState(), "6", manager);
    const after = resolveAssistantInput(opened.state, "6", manager);
    expect(before).toMatchObject({ kind: "menu", menuKey: "management_reports" });
    expect(after).toMatchObject({ kind: "action", action: "missed_patrols" });
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

describe("permission-checked mode switching", () => {
  it("switches an authorized user into management mode only", () => {
    const result = resolveAssistantInput(userState(), "12", manager);
    expect(result.kind).toBe("menu");
    expect(result.state.mode).toBe("management");
    expect(result.state.activeMenu).toBe(MANAGEMENT_HOME);
  });

  it("denies management switching for unauthorized users", () => {
    const result = resolveAssistantInput(userState(), "12", guard);
    expect(result).toMatchObject({ kind: "denied" });
    expect(result.state.mode).toBe("user");
  });

  it("blocks management actions typed directly by unauthorized users", () => {
    expect(resolveAssistantInput(userState(), "lock device MX-021", guard)).toMatchObject({ kind: "denied" });
    expect(resolveAssistantInput(userState(), "generate report", guard)).toMatchObject({ kind: "denied" });
  });

  it("returns to the user assistant from management", () => {
    const result = resolveAssistantInput(mgmtState(), "9", manager);
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

  it("routes patrol outcomes from any menu", () => {
    expect(resolveAssistantInput(mgmtState("management_devices"), "which checkpoints were missed?", manager)).toMatchObject({ action: "missed_checkpoints" });
    expect(resolveAssistantInput(userState("user_reports"), "show missed patrols", guard)).toMatchObject({ action: "missed_patrols" });
    expect(resolveAssistantInput(userState(), "which devices are offline", guard)).toMatchObject({ action: "devices_offline" });
  });

  it("keeps the active site across navigation", () => {
    const opened = resolveAssistantInput(mgmtState(), "1", manager);
    expect(opened.state.activeSiteId).toBe("site-1");
    expect(resolveAssistantInput(opened.state, "6", manager).state.activeSiteId).toBe("site-1");
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
