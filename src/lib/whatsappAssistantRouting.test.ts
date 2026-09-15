import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MANAGEMENT_HOME_KEY,
  USER_HOME_KEY,
  WA_SUBMENUS,
  backTarget,
  patrolStatusView,
  patrolSessionDrilldownView,
  mainMenu,
  managementMenu,
  patrolStatusOverview,
  reportPeriodMenu,
  resolveMenuChoice,
} from "../../supabase/functions/whatsapp-webhook/lib/views";
import { keywordIntent } from "../../supabase/functions/whatsapp-webhook/lib/askmx";
import { renderText, twiml } from "../../supabase/functions/whatsapp-webhook/lib/render";
import type { Identity, OutMessage, SessionRow } from "../../supabase/functions/whatsapp-webhook/lib/types";

const identity: Identity = {
  id: "auth-1",
  phone: "+27820000000",
  company_id: "company-1",
  user_id: "user-1",
  guard_id: null,
  display_name: "Ops User",
  role: "supervisor",
  allowed_site_ids: ["site-1"],
  canSetup: false,
  canManage: true,
  canManageKiosk: false,
  platformRole: null,
  canAcknowledge: true,
  canManageSecureDevices: false,
};

const session = (patch: Partial<SessionRow> = {}): SessionRow => ({
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
  ...patch,
});

function withMenu(menuKey: string, last_menu = "management"): SessionRow {
  const menu = menuKey === MANAGEMENT_HOME_KEY ? managementMenu(identity, session({ last_menu })) : WA_SUBMENUS[menuKey];
  return session({
    last_menu,
    temporary_data: { last_options: menu.options ?? [], last_menu_key: menuKey },
  });
}

describe("WhatsApp nested menu numbering uses the current conversation state", () => {
  it("management home 1 selects Operations", () => {
    expect(resolveMenuChoice(withMenu(MANAGEMENT_HOME_KEY), "1")).toBe("management_operations");
  });

  it("operations 2 selects Patrol Status and 3 missed checkpoints", () => {
    expect(resolveMenuChoice(withMenu("management_operations"), "2")).toBe("patrol_status");
    expect(resolveMenuChoice(withMenu("management_operations"), "3")).toBe("missed_checkpoints");
  });

  it("user home numbering stays on the user menu", () => {
    const userSession = session({ temporary_data: { last_options: mainMenu(identity, session()).options ?? [], last_menu_key: USER_HOME_KEY } });
    expect(resolveMenuChoice(userSession, "3")).toBe("patrol_status");
    expect(resolveMenuChoice(userSession, "6")).toBe("reports");
    expect(resolveMenuChoice(userSession, "7")).toBe("change_site");
  });

  it("back resolves to the parent of the displayed menu", () => {
    expect(backTarget(withMenu("management_operations"))).toBe(MANAGEMENT_HOME_KEY);
    expect(backTarget(withMenu("management_reports"))).toBe(MANAGEMENT_HOME_KEY);
    expect(backTarget(session({ last_menu: "user" }))).toBe(USER_HOME_KEY);
  });

  it("back from Patrol Status returns to the right parent per mode", () => {
    expect(backTarget(session({ last_menu: "management", temporary_data: { last_menu_key: "patrol_status" } }))).toBe("management_operations");
    expect(backTarget(session({ last_menu: "user", temporary_data: { last_menu_key: "patrol_status" } }))).toBe(USER_HOME_KEY);
  });

  it("ignores numbers with no menu context instead of guessing", () => {
    expect(resolveMenuChoice(session(), "6")).toBeNull();
    expect(resolveMenuChoice(withMenu("management_operations"), "99")).toBeNull();
  });

  it('keeps the active site name in empty drill-down headings', async () => {
    const emptyClient = { from: () => ({ select() { return this; }, in() { return this; }, gte() { return this; }, lte() { return this; }, order() { return this; }, limit() { return this; }, eq() { return this; }, then(resolve: (value: { data: unknown[] }) => unknown) { return resolve({ data: [] }); } }) } as any;
    const late = await patrolSessionDrilldownView(emptyClient, identity, 'site-1', 'late', 'Airport Junction');
    expect(late.title).toBe('LATE SESSIONS - Airport Junction');
    expect(late.lines.join('\n')).toContain('No late patrol sessions found for the selected period.');

    const missed = await patrolSessionDrilldownView(emptyClient, identity, 'site-1', 'missed', 'Airport Junction');
    expect(missed.title).toBe('MISSED SESSIONS - Airport Junction');
  });
});

describe("WhatsApp Patrol Status consolidates the four outcomes", () => {
  const removed = ["completed_patrols", "incomplete_patrols", "late_patrols", "missed_patrols"];

  it("removes the individual outcome options from the parent menus", () => {
    const operations = (WA_SUBMENUS["management_operations"].options ?? []).map((option) => option.id);
    const userHome = (mainMenu(identity, session()).options ?? []).map((option) => option.id);
    for (const id of removed) {
      expect(operations).not.toContain(id);
      expect(userHome).not.toContain(id);
    }
    expect(operations).toContain("patrol_status");
    expect(userHome).toContain("patrol_status");
  });

  it("shows all four active-site counts and drills into each detailed list", async () => {
    const rows = [
      { status: "completed", site_id: "site-1" },
      { status: "completed_late", site_id: "site-1" },
      { status: "incomplete", site_id: "site-1" },
      { status: "missed", site_id: "site-1" },
    ];
    const captured: Array<[string, unknown]> = [];
    const query: any = {
      select: () => query,
      limit: () => query,
      gte: () => query,
      lte: () => query,
      in: (col: string, value: unknown) => { captured.push([col, value]); return query; },
      eq: (col: string, value: unknown) => { captured.push([col, value]); return query; },
      then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data: rows }),
    };
    const client: any = { from: () => query };

    const view = await patrolStatusOverview(client, identity, "site-1", "Airport Junction");
    expect(captured).toContainEqual(["site_id", "site-1"]);
    expect(view.title).toContain("Airport Junction");
    expect(view.lines).toContain("Completed sessions: 2");
    expect(view.lines).toContain("Incomplete sessions: 1");
    expect(view.lines).toContain("Late sessions: 1");
    expect(view.lines).toContain("Missed sessions: 1");

    const options = (view.options ?? []).map((option) => option.id);
    expect(options.slice(0, 4)).toEqual(removed);
    const statusSession = session({ temporary_data: { last_options: view.options ?? [], last_menu_key: "patrol_status" } });
    expect(resolveMenuChoice(statusSession, "1")).toBe("completed_patrols");
    expect(resolveMenuChoice(statusSession, "2")).toBe("incomplete_patrols");
    expect(resolveMenuChoice(statusSession, "3")).toBe("late_patrols");
    expect(resolveMenuChoice(statusSession, "4")).toBe("missed_patrols");
    expect(resolveMenuChoice(statusSession, "5")).toBe("back");
  });
});


describe('WhatsApp patrol status summaries use patrol sessions', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, index) => ({ id: 'gate-c-' + index, status: 'completed', scheduled_start: '2026-09-15T06:00:00.000Z', site_id: 'site-1', sites: { name: 'Tlokweng' }, patrol_routes: { id: 'gate', name: 'Gate Patrol' } })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: 'gate-i-' + index, status: 'incomplete', scheduled_start: '2026-09-15T08:00:00.000Z', site_id: 'site-1', sites: { name: 'Tlokweng' }, patrol_routes: { id: 'gate', name: 'Gate Patrol' } })),
    { id: 'perimeter-late', status: 'late_start', scheduled_start: '2026-09-15T09:00:00.000Z', actual_start: '2026-09-15T09:12:00.000Z', site_id: 'site-1', sites: { name: 'Tlokweng' }, patrol_routes: { id: 'perimeter', name: 'Perimeter Patrol' } },
    { id: 'server-missed', status: 'missed', scheduled_start: '2026-09-15T10:00:00.000Z', site_id: 'site-1', sites: { name: 'Tlokweng' }, patrol_routes: { id: 'server', name: 'Server Patrol' } },
  ];

  function clientFor(data: unknown[]) {
    const query: any = {
      select: () => query,
      gte: () => query,
      lte: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data }),
    };
    return { from: () => query } as any;
  }

  it('shows completed sessions over expected sessions per Patrol', async () => {
    const view = await patrolStatusView(clientFor(rows), identity, 'site-1', 'completed');
    const text = view.lines.join('\n');
    expect(text).toContain('Gate Patrol - 6 / 8 sessions completed');
    expect(text).toContain('Total: 6 / 8 sessions completed');
    expect(text).not.toContain('Checkpoints:');
    expect(text).not.toContain('Scheduled:');
  });

  it('shows incomplete, late and missed session counts without denominators', async () => {
    const incomplete = await patrolStatusView(clientFor(rows), identity, 'site-1', 'incomplete');
    expect(incomplete.lines.join('\n')).toContain('Gate Patrol - 2 incomplete sessions');
    expect(incomplete.lines.join('\n')).toContain('Total incomplete sessions: 2');

    const late = await patrolStatusView(clientFor(rows), identity, 'site-1', 'late');
    expect(late.lines.join('\n')).toContain('Perimeter Patrol - 1 late session');
    expect(late.lines.join('\n')).toContain('Type late sessions to view late session details.');
    expect(late.lines.join('\n')).not.toContain('Actual start');

    const missed = await patrolStatusView(clientFor(rows), identity, 'site-1', 'missed');
    expect(missed.lines.join('\n')).toContain('Server Patrol - 1 missed session');
    expect(missed.lines.join('\n')).toContain('Type missed to view missed session details.');
    expect(missed.lines.join('\n')).not.toContain('missed checkpoint');
  });

  it('drills into late and missed sessions without checkpoint detail', async () => {
    const late = await patrolSessionDrilldownView(clientFor(rows), identity, 'site-1', 'late');
    const lateText = late.lines.join('\n');
    expect(late.title).toContain('LATE SESSIONS');
    expect(lateText).toContain('Perimeter Patrol');
    expect(lateText).toContain('11:00 session - 12 min late');
    expect(lateText).not.toContain('Checkpoints');

    const missed = await patrolSessionDrilldownView(clientFor(rows), identity, 'site-1', 'missed');
    const missedText = missed.lines.join('\n');
    expect(missed.title).toContain('MISSED SESSIONS');
    expect(missedText).toContain('Server Patrol');
    expect(missedText).toContain('12:00 session - Missed');
    expect(missedText).not.toContain('scan log');
  });
});
describe("WhatsApp report language routing", () => {
  it("routes report requests to the reports action with the right period", () => {
    expect(keywordIntent("reports")).toEqual({ action: "reports" });
    expect(keywordIntent("show reports")).toEqual({ action: "reports" });
    expect(keywordIntent("give me today's report")).toEqual({ action: "reports", period: "today" });
    expect(keywordIntent("show yesterday's report")).toEqual({ action: "reports", period: "yesterday" });
    expect(keywordIntent("generate patrol report")).toEqual({ action: "reports" });
  });

  it("routes patrol status language", () => {
    expect(keywordIntent("patrol status")).toEqual({ action: "patrol_status" });
  });
});

describe("WhatsApp reports category menus", () => {
  it("hides Device Security Reports unless the identity is a platform owner", () => {
    const normalOptions = reportPeriodMenu(identity).options ?? [];
    expect(normalOptions.map((option) => option.label)).not.toContain("Device Security Reports");
    expect(resolveMenuChoice(session({ temporary_data: { last_options: normalOptions, last_menu_key: "report_period" } }), "8")).toBe("back");

    const owner = { ...identity, platformRole: "owner" as const, canManageKiosk: true, canManageSecureDevices: true };
    const ownerOptions = reportPeriodMenu(owner).options ?? [];
    expect(ownerOptions[7]).toMatchObject({ id: "reports_device_security", label: "Device Security Reports" });
  });

  it("routes report submenus from the last displayed options", () => {
    const reportMenu = reportPeriodMenu(identity);
    const reportSession = session({ temporary_data: { last_options: reportMenu.options ?? [], last_menu_key: "report_period" } });
    expect(resolveMenuChoice(reportSession, "1")).toBe("reports_period");
    expect(resolveMenuChoice(reportSession, "2")).toBe("reports_checkpoint_activity");
    expect(resolveMenuChoice(reportSession, "3")).toBe("reports_patrols");
    expect(resolveMenuChoice(reportSession, "4")).toBe("reports_scan_investigations");

    const scanSession = session({ temporary_data: { last_options: WA_SUBMENUS.reports_checkpoint_activity.options ?? [], last_menu_key: "reports_checkpoint_activity" } });
    expect(resolveMenuChoice(scanSession, "3")).toBe("report:checkpoint_activity:device");
    expect(backTarget(scanSession)).toBe("report_period");
  });
});



describe("WhatsApp text encoding guardrails", () => {
  const whatsappSources = [
    "supabase/functions/whatsapp-webhook/index.ts",
    "supabase/functions/whatsapp-webhook/lib/askmx.ts",
    "supabase/functions/whatsapp-webhook/lib/flows.ts",
    "supabase/functions/whatsapp-webhook/lib/render.ts",
    "supabase/functions/whatsapp-webhook/lib/request.ts",
    "supabase/functions/whatsapp-webhook/lib/types.ts",
    "supabase/functions/whatsapp-webhook/lib/views.ts",
  ];

  it("keeps deployed WhatsApp source free of common mojibake markers", () => {
    for (const sourcePath of whatsappSources) {
      const source = readFileSync(sourcePath, "utf8");
      expect(source, sourcePath).not.toMatch(/ðŸ|Ã|Â|â|�/);
    }
  });

  it("preserves emoji and WhatsApp markdown through plain text rendering and form encoding", () => {
    const message: OutMessage = {
      title: "SEVERITY",
      lines: ["How serious is it?", "", "Status symbols: ✅ ❌ ⚠️ 📍 📱 🚨"],
      options: [
        { id: "low", label: "🟢 Minor" },
        { id: "medium", label: "🟡 Moderate" },
        { id: "high", label: "🟠 Serious" },
        { id: "critical", label: "🔴 Emergency" },
      ],
      footer: "Reply with a number, or type *menu*.",
    };

    const rendered = renderText(message);
    expect(rendered).toBe([
      "*SEVERITY*",
      "How serious is it?\n\nStatus symbols: ✅ ❌ ⚠️ 📍 📱 🚨",
      "1. 🟢 Minor\n2. 🟡 Moderate\n3. 🟠 Serious\n4. 🔴 Emergency",
      "Reply with a number, or type *menu*.",
    ].join("\n\n"));
    expect(rendered).not.toMatch(/ðŸ|Ã|Â|â|�/);

    const encoded = new URLSearchParams({ Body: rendered });
    expect(encoded.get("Body")).toBe(rendered);
    expect(twiml(rendered)).toContain("encoding=\"UTF-8\"");
    expect(twiml(rendered)).toContain("🟢 Minor");
  });
});

