// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import type { Identity, OutMessage, SessionRow } from "./types.ts";
import { greeting, timeAgo } from "./types.ts";
import { deviceSecurityState, formatDeviceSecurityLine, formatSecureDeviceLabel, getSecureDeviceByIdentifier, getSecureDeviceEvents, getSecureDeviceRows, getSecureDeviceSummary } from "../../_shared/secure-device-management.ts";

const REPORT_ROOT_OPTIONS = [
  { id: "reports_period", label: "Daily / Weekly Summary" },
  { id: "reports_checkpoint_activity", label: "Checkpoint Activity", entitlement: "checkpoint_reports" },
  { id: "reports_patrols", label: "Patrol Reports", entitlement: "patrol_reports" },
  { id: "reports_scan_investigations", label: "Scan Investigations", entitlement: "scan_investigations" },
  { id: "reports_incidents", label: "Incident Reports", entitlement: "incident_reports" },
  { id: "reports_sos", label: "SOS Reports", entitlement: "incident_reports" },
  { id: "reports_devices", label: "Device Reports", entitlement: "device_reports" },
  { id: "reports_device_security", label: "Device Security Reports", ownerOnly: true, entitlement: "device_reports" },
  { id: "back", label: "Back" },
];

const REPORT_PACKAGE_ENTITLEMENTS: Record<string, string[]> = {
  basic: ["checkpoint_reports", "incident_reports"],
  standard: ["checkpoint_reports", "scan_investigations", "device_reports", "incident_reports"],
  professional: ["checkpoint_reports", "scan_investigations", "device_reports", "patrol_reports", "incident_reports"],
  enterprise: ["checkpoint_reports", "scan_investigations", "device_reports", "patrol_reports", "incident_reports"],
};

function hasReportEntitlement(packageName: string | null | undefined, entitlement: string | undefined): boolean {
  if (!entitlement) return true;
  const key = String(packageName ?? "enterprise").toLowerCase();
  return (REPORT_PACKAGE_ENTITLEMENTS[key] ?? REPORT_PACKAGE_ENTITLEMENTS.enterprise).includes(entitlement);
}

function reportRootOptions(identity: Identity) {
  return REPORT_ROOT_OPTIONS.filter((option) => {
    if (option.ownerOnly && identity.platformRole !== "owner") return false;
    return hasReportEntitlement(identity.reportPackage, option.entitlement);
  });
}

function reportMenu(title: string, menuKey: string, options: Array<{ id: string; label: string }>): OutMessage {
  return { title, menuKey, lines: ["Choose a report category."], options };
}
function siteFilter<T>(query: any, identity: Identity, siteId: string | null) {
  let next = query.eq("company_id", identity.company_id);
  if (siteId) next = next.eq("site_id", siteId);
  else if (identity.allowed_site_ids.length) next = next.in("site_id", identity.allowed_site_ids);
  return next as T;
}

export function mainMenu(identity: Identity, session: SessionRow): OutMessage {
  const context = session.current_site_name ? `Site: ${session.current_site_name}` : "Choose a site to continue.";
  return {
    title: "MX PATROL",
    menuKey: "user_home",
    lines: [
      greeting(),
      context,
      "What would you like to do?",
    ],
    options: [
      { id: "live", label: "Live Now" },
      { id: "attention", label: "Attention" },
      { id: "patrol_status", label: "Patrol Status" },
      { id: "devices", label: "Devices" },
      { id: "incidents", label: "Incidents" },
      { id: "reports", label: "Reports" },
      { id: "change_site", label: "Change Site" },
      { id: "management", label: "Management" },
    ],

    footer: "Or ask me: \"Which devices are offline?\"",
  };
}
export function managementMenu(identity: Identity, session: SessionRow): OutMessage {
  if (!identity.canManage) {
    return {
      title: "MANAGEMENT ACCESS UNAVAILABLE",
      lines: ["Your account does not have permission to use management actions."],
      options: [{ id: "menu", label: "User Assistant" }],
    };
  }
  return {
    title: "MX PATROL - MANAGEMENT",
    menuKey: "management_home",
    lines: [session.current_site_name ? `Viewing: ${session.current_site_name}` : "Choose a site before making changes.", "What would you like to manage?"],
    options: [
      { id: "management_operations", label: "Operations" },
      { id: "management_devices", label: "Devices" },
      { id: "management_checkpoints", label: "Checkpoints" },
      { id: "management_incidents", label: "Incidents" },
      { id: "management_patrol_config", label: "Patrol Configuration" },
      { id: "management_reports", label: "Reports" },
      { id: "management_whatsapp", label: "WhatsApp Management" },
      ...(identity.canManageSecureDevices && identity.platformRole === "owner"
        ? [{ id: "secure_devices", label: "Secure Patrol Devices" }]
        : []),
      { id: "change_site", label: "Change Site" },
      { id: "user", label: "User Assistant" },
    ],
  };
}

export async function liveNow(
  client: SupabaseClient,
  identity: Identity,
  siteId: string | null,
): Promise<OutMessage> {
  const { data: devices } = await siteFilter<any>(
    client.from("devices").select("id, status, pairing_status, site_id"),
    identity,
    siteId,
  );
  const { data: sessions } = await siteFilter<any>(
    client
      .from("patrol_sessions")
      .select("id, status, site_id")
      .in("status", ["active", "in_progress"]),
    identity,
    siteId,
  );
  let alertsQuery = client
    .from("alerts")
    .select("id, type, severity, site_id")
    .eq("company_id", identity.company_id)
    .eq("is_read", false);
  if (siteId) alertsQuery = alertsQuery.eq("site_id", siteId);
  else if (identity.allowed_site_ids.length) alertsQuery = alertsQuery.in("site_id", identity.allowed_site_ids);
  const { data: alerts } = await alertsQuery;

  const active = (devices ?? []).filter((d: any) => d.status === "online").length;
  const sos = (alerts ?? []).filter((a: any) => a.type === "panic_button").length;
  const attention = (alerts ?? []).length;

  return {
    title: "LIVE NOW",
    lines: [
      `${active} active device${active === 1 ? "" : "s"}`,
      `${(sessions ?? []).length} patrol${(sessions ?? []).length === 1 ? "" : "s"} in progress`,
      `${attention} attention item${attention === 1 ? "" : "s"}`,
      `${sos} SOS alert${sos === 1 ? "" : "s"}`,
    ],
    options: [
      { id: "patrols", label: "View Active Patrols" },
      { id: "devices", label: "View Devices" },
      ...(identity.canManageKiosk ? [{ id: "secure_devices", label: "Secure Patrol Devices" }] : []),
      { id: "attention", label: "View Live Problems" },
    ],
  };
}

export async function activePatrols(
  client: SupabaseClient,
  identity: Identity,
  siteId: string | null,
): Promise<OutMessage> {
  const { data } = await siteFilter<any>(
    client
      .from("patrol_sessions")
      .select(
        "id, status, device_identifier, checkpoint_completed, checkpoint_total, last_scan_at, site_id, sites(name), patrol_routes(name)",
      )
      .in("status", ["active", "in_progress", "awaiting_start", "late_start"])
      .order("scheduled_start", { ascending: false })
      .limit(5),
    identity,
    siteId,
  );

  if (!data?.length) {
    return { title: "ACTIVE PATROLS", lines: ["No patrols are running right now."], options: [{ id: "menu", label: "Main Menu" }] };
  }

  const lines: string[] = [];
  for (const row of data as any[]) {
    const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
    const route = Array.isArray(row.patrol_routes) ? row.patrol_routes[0] : row.patrol_routes;
    lines.push(
      [
        `*${site?.name ?? route?.name ?? "Patrol"}*`,
        `Device: ${row.device_identifier ?? "No device"}`,
        `Status: ${String(row.status).replace(/_/g, " ")}`,
        `Checkpoints: ${row.checkpoint_completed ?? 0} / ${row.checkpoint_total ?? 0}`,
        `Last activity: ${timeAgo(row.last_scan_at)}`,
      ].join("\n"),
    );
  }

  return {
    title: "ACTIVE PATROLS",
    lines: [lines.join("\n\n")],
    options: [
      { id: "devices", label: "View Devices" },
      { id: "secure_devices", label: "Secure Patrol Devices" },
      { id: "attention", label: "Problems" },
      { id: "menu", label: "Main Menu" },
    ],
  };
}

export async function attention(
  client: SupabaseClient,
  identity: Identity,
  filter: "all" | "sos" | "missed" | "offline" = "all",
  siteId: string | null = null,
): Promise<OutMessage> {
  let query = client
    .from("alerts")
    .select("id, type, message, severity, created_at, device_identifier")
    .eq("company_id", identity.company_id)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(10);

  if (siteId) query = query.eq("site_id", siteId);
  else if (identity.allowed_site_ids.length) query = query.in("site_id", identity.allowed_site_ids);

  if (filter === "sos") query = query.eq("type", "panic_button");
  if (filter === "missed") query = query.eq("type", "missed_checkpoint");
  if (filter === "offline") query = query.eq("type", "device_offline");

  const { data } = await query;
  const rows = (data ?? []) as any[];

  if (!rows.length) {
    return { title: "ATTENTION", lines: ["Nothing needs attention right now."], options: [{ id: "menu", label: "Main Menu" }] };
  }

  const counts = {
    critical: rows.filter((r) => r.severity === "critical").length,
    medium: rows.filter((r) => r.severity === "medium" || r.severity === "high").length,
    low: rows.filter((r) => r.severity === "low" || !r.severity).length,
  };

  const detail = rows
    .slice(0, 5)
    .map((row) => {
      const label = row.type === "panic_button" ? "Critical" : row.type === "device_offline" ? "Offline" : "Attention";
      return `${label}: ${row.message}\nAge: ${timeAgo(row.created_at)}`;
    })
    .join("\n\n");

  const options = [
    { id: "sos", label: "SOS Alerts" },
    { id: "missed", label: "Missed Checkpoints" },
    { id: "offline", label: "Offline Devices" },
  ];
  if (filter === "sos" && identity.canAcknowledge) options.unshift({ id: "ack", label: "Acknowledge All SOS" });

  return {
    title: `${rows.length} ITEM${rows.length === 1 ? "" : "S"} NEED ATTENTION`,
    lines: [
      `${counts.critical} Critical`,
      `${counts.medium} Medium`,
      `${counts.low} Low`,
      "",
      detail,
    ],
    options,
  };
}

export async function deviceList(
  client: SupabaseClient,
  identity: Identity,
  siteId: string | null,
): Promise<OutMessage> {
  const { data } = await siteFilter<any>(
    client
      .from("devices")
      .select("id, device_name, device_identifier, status, last_seen_at, site_id")
      .order("device_identifier")
      .limit(10),
    identity,
    siteId,
  );
  const rows = (data ?? []) as any[];

  const online = rows.filter((r) => r.status === "online").length;
  const offline = rows.filter((r) => r.status === "offline").length;

  return {
    title: "DEVICES",
    lines: [
      `Total: ${rows.length}`,
      `Online: ${online}`,
      `Offline: ${offline}`,
      "",
      rows.length ? "Choose a device:" : "No devices registered yet.",
    ],
    options: rows.map((row) => ({
      id: `device:${row.device_identifier}`,
      label: `${row.device_identifier} - ${row.status === "online" ? "Online" : "Offline"}`,
    })),
  };
}

export async function deviceDetail(
  client: SupabaseClient,
  identity: Identity,
  needle: string,
): Promise<{ message: OutMessage; gps?: { lat: number; lng: number; label: string } }> {
  const { data: devices } = await client
    .from("devices")
    .select(
      "id, device_name, device_identifier, status, last_seen_at, battery_level, site_id, current_gps_lat, current_gps_lng, current_gps_at, sites(name)",
    )
    .eq("company_id", identity.company_id)
    .ilike("device_identifier", `%${needle}%`)
    .limit(1);

  const device = (devices ?? [])[0] as any;
  if (!device) {
    return {
      message: {
        title: "DEVICE NOT FOUND",
        lines: [`I couldn't find a device matching ${needle}.`],
        options: [{ id: "devices", label: "View Devices" }, { id: "menu", label: "Main Menu" }],
      },
    };
  }

  const site = Array.isArray(device.sites) ? device.sites[0] : device.sites;

  const { data: sessions } = await client
    .from("patrol_sessions")
    .select("checkpoint_completed, checkpoint_total, status, patrol_routes(name)")
    .eq("company_id", identity.company_id)
    .eq("device_identifier", device.device_identifier)
    .order("scheduled_start", { ascending: false })
    .limit(1);
  const session = (sessions ?? [])[0] as any;
  const route = session ? (Array.isArray(session.patrol_routes) ? session.patrol_routes[0] : session.patrol_routes) : null;

  const { data: scans } = await client
    .from("scan_logs")
    .select("scanned_at, checkpoints(name)")
    .eq("company_id", identity.company_id)
    .eq("device_identifier", device.device_identifier)
    .not("checkpoint_id", "is", null)
    .order("scanned_at", { ascending: false })
    .limit(1);
  const lastScan = (scans ?? [])[0] as any;
  const lastCheckpoint = lastScan
    ? (Array.isArray(lastScan.checkpoints) ? lastScan.checkpoints[0] : lastScan.checkpoints)?.name
    : null;

  const hasGps = device.current_gps_lat != null && device.current_gps_lng != null;

  return {
    message: {
      title: device.device_identifier,
      lines: [
        device.status === "online" ? "Online" : "Offline",
        "",
        `Site: ${site?.name ?? "Unassigned"}`,
        `Last seen: ${timeAgo(device.last_seen_at)}`,
        `Last checkpoint: ${lastCheckpoint ?? "None yet"}`,
        route?.name ? `Patrol: ${route.name}` : "Patrol: None",
        session ? `Progress: ${session.checkpoint_completed ?? 0}/${session.checkpoint_total ?? 0}` : "Progress: none",
        `GPS: ${hasGps ? "Available" : "Not available"}`,
      ],
      options: [
        ...(hasGps ? [{ id: `location:${device.device_identifier}`, label: "Location" }] : []),
        { id: "attention", label: "Problems" },
        { id: "menu", label: "Main Menu" },
      ],
    },
    gps: hasGps
      ? {
        lat: Number(device.current_gps_lat),
        lng: Number(device.current_gps_lng),
        label: `${device.device_identifier} - ${site?.name ?? "Unknown site"}`,
      }
      : undefined,
  };
}

export async function incidentsView(
  client: SupabaseClient,
  identity: Identity,
  siteId: string | null,
): Promise<OutMessage> {
  const { data } = await siteFilter<any>(
    client
      .from("incidents")
      .select("id, title, severity, resolved, created_at, site_id")
      .order("created_at", { ascending: false })
      .limit(5),
    identity,
    siteId,
  );
  const rows = (data ?? []) as any[];

  return {
    title: "INCIDENTS",
    lines: rows.length
      ? [rows.map((r) => `${r.resolved ? "" : " "} ${r.title}\n${String(r.severity).toUpperCase()}  ${timeAgo(r.created_at)}`).join("\n\n")]
      : ["No incidents recorded."],
    options: [
      { id: "report_incident", label: "Report Incident" },
      { id: "menu", label: "Main Menu" },
    ],
  };
}

function periodStart(period: string): Date {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "yesterday") start.setDate(start.getDate() - 1);
  if (period === "week") start.setDate(start.getDate() - 7);
  return start;
}

function periodEnd(period: string): Date {
  const end = new Date();
  if (period === "yesterday") {
    end.setHours(0, 0, 0, 0);
  }
  return end;
}

export async function reportSummary(
  client: SupabaseClient,
  identity: Identity,
  siteId: string | null,
  period: "today" | "yesterday" | "week",
  problemsOnly = false,
): Promise<OutMessage> {
  const from = periodStart(period).toISOString();
  const to = periodEnd(period).toISOString();

  const { data: sessions } = await siteFilter<any>(
    client
      .from("patrol_sessions")
      .select("id, status, checkpoint_completed, checkpoint_total, site_id, sites(name), patrol_routes(name)")
      .gte("scheduled_start", from)
      .lte("scheduled_start", to),
    identity,
    siteId,
  );
  const { data: scans } = await siteFilter<any>(
    client.from("scan_logs").select("id, site_id").gte("scanned_at", from).lte("scanned_at", to),
    identity,
    siteId,
  );
  const { data: incidents } = await siteFilter<any>(
    client.from("incidents").select("id, title, site_id").gte("created_at", from).lte("created_at", to),
    identity,
    siteId,
  );
  let alertsQuery = client
    .from("alerts")
    .select("id, type, message, site_id")
    .eq("company_id", identity.company_id)
    .gte("created_at", from)
    .lte("created_at", to);
  if (siteId) alertsQuery = alertsQuery.eq("site_id", siteId);
  else if (identity.allowed_site_ids.length) alertsQuery = alertsQuery.in("site_id", identity.allowed_site_ids);
  const { data: alerts } = await alertsQuery;
  const { data: devices } = await siteFilter<any>(
    client.from("devices").select("id, status, device_identifier, site_id"),
    identity,
    siteId,
  );

  const sessionRows = (sessions ?? []) as any[];
  const completed = sessionRows.filter((s) => s.status === "completed" || s.status === "completed_late").length;
  const missedCheckpoints = sessionRows.reduce(
    (total, s) => total + Math.max((s.checkpoint_total ?? 0) - (s.checkpoint_completed ?? 0), 0),
    0,
  );
  const sos = (alerts ?? []).filter((a: any) => a.type === "panic_button").length;
  const label = period === "today" ? "TODAY" : period === "yesterday" ? "YESTERDAY" : "THIS WEEK";

  if (problemsOnly) {
    const problems: string[] = [];
    for (const device of (devices ?? []) as any[]) {
      if (device.status === "offline") problems.push(`- ${device.device_identifier} offline`);
    }
    for (const session of sessionRows) {
      const done = session.checkpoint_completed ?? 0;
      const total = session.checkpoint_total ?? 0;
      if (total > 0 && done < total) {
        const site = Array.isArray(session.sites) ? session.sites[0] : session.sites;
        const route = Array.isArray(session.patrol_routes) ? session.patrol_routes[0] : session.patrol_routes;
        problems.push(`- ${site?.name ?? route?.name ?? "Patrol"} completed ${done}/${total} checkpoints`);
      }
    }
    for (const alert of (alerts ?? []) as any[]) {
      if (alert.type === "missed_checkpoint") problems.push(`- ${alert.message}`);
    }

    return {
      title: problems.length ? `${problems.length} things need attention` : "Nothing went wrong",
      lines: problems.length ? [problems.slice(0, 12).join("\n")] : ["Everything completed normally."],
      options: [{ id: "reports", label: "Reports" }, { id: "menu", label: "Main Menu" }],
    };
  }

  return {
    title: `${label}'S SECURITY SUMMARY`,
    lines: [
      `Devices active: ${((devices ?? []) as any[]).filter((d) => d.status === "online").length}`,
      `Patrols completed: ${completed}`,
      `Checkpoints scanned: ${(scans ?? []).length}`,
      `Missed checkpoints: ${missedCheckpoints}`,
      `Incidents: ${(incidents ?? []).length}`,
      `SOS alerts: ${sos}`,
    ],
    options: [
      { id: "problems", label: "Problems Only" },
      { id: "reports", label: "Change Period" },
      { id: "menu", label: "Main Menu" },
    ],
  };
}

export function reportPeriodMenu(identity?: Identity): OutMessage {
  return {
    title: "REPORTS",
    menuKey: "report_period",
    lines: ["Please choose a report category:"],
    options: reportRootOptions(identity ?? ({ platformRole: null } as Identity)),
  };
}

export function setupMenu(): OutMessage {
  return {
    title: "SETUP",
    lines: ["What would you like to set up?"],
    options: [
      { id: "register_device", label: "Register Device" },
      { id: "add_checkpoint", label: "Add Checkpoint" },
      { id: "create_patrol", label: "Create Patrol" },
    ],
  };
}

export async function checkpointsView(client: SupabaseClient, identity: Identity, siteId: string | null): Promise<OutMessage> {
  const { data } = await siteFilter<any>(
    client.from("checkpoints").select("id, name, nfc_tag_id, site_id, created_at").order("name").limit(12),
    identity,
    siteId,
  );
  const rows = (data ?? []) as any[];
  return {
    title: "CHECKPOINTS",
    lines: rows.length
      ? [rows.map((row, index) => `${index + 1}. ${row.name}\nNFC: ${row.nfc_tag_id ? "Assigned" : "Awaiting assignment"}`).join("\n\n")]
      : ["No checkpoints registered for this site."],
    options: [{ id: "menu", label: "Main Menu" }],
  };
}

const PATROL_STATUS_GROUPS = {
  completed: ["completed", "completed_late"],
  incomplete: ["incomplete"],
  late: ["late", "delayed", "late_start", "completed_late"],
  missed: ["missed"],
} as const;

const TZ = "Africa/Johannesburg";

function waTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(date);
}

function waDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", timeZone: TZ }).format(date);
}

const PATROL_STATUS_LABELS: Record<keyof typeof PATROL_STATUS_GROUPS, string> = {
  completed: "Completed",
  incomplete: "Incomplete",
  late: "Late / Delayed",
  missed: "Missed",
};

/** Patrol Status overview: real, site-scoped counts with numbered drill-down options. */
export async function patrolStatusOverview(
  client: SupabaseClient,
  identity: Identity,
  siteId: string | null,
  siteName?: string | null,
): Promise<OutMessage> {
  const { data } = await siteFilter<any>(
    client.from("patrol_sessions").select("id, status, site_id").limit(500),
    identity,
    siteId,
  );
  const rows = (data ?? []) as any[];
  const count = (group: keyof typeof PATROL_STATUS_GROUPS) =>
    rows.filter((row) => (PATROL_STATUS_GROUPS[group] as readonly string[]).includes(String(row.status))).length;

  return {
    title: siteName ? `PATROL STATUS - ${siteName}` : "PATROL STATUS",
    menuKey: "patrol_status",
    lines: [
      `Completed: ${count("completed")}`,
      `Incomplete: ${count("incomplete")}`,
      `Late / Delayed: ${count("late")}`,
      `Missed: ${count("missed")}`,
      "",
      "Choose a status for the detailed list.",
    ],
    options: [
      { id: "completed_patrols", label: PATROL_STATUS_LABELS.completed },
      { id: "incomplete_patrols", label: PATROL_STATUS_LABELS.incomplete },
      { id: "late_patrols", label: PATROL_STATUS_LABELS.late },
      { id: "missed_patrols", label: PATROL_STATUS_LABELS.missed },
      { id: "back", label: "Back" },
    ],
  };
}

function lateBy(scheduled: string | null, actual: string | null): string | null {
  if (!scheduled || !actual) return null;
  const diff = new Date(actual).getTime() - new Date(scheduled).getTime();

  if (!Number.isFinite(diff) || diff <= 0) return null;
  const mins = Math.round(diff / 60000);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export async function patrolStatusView(
  client: SupabaseClient,
  identity: Identity,
  siteId: string | null,
  group: keyof typeof PATROL_STATUS_GROUPS,
): Promise<OutMessage> {
  const statuses = [...PATROL_STATUS_GROUPS[group]];
  const { data } = await siteFilter<any>(
    client
      .from("patrol_sessions")
      .select("id, status, scheduled_start, scheduled_end, actual_start, checkpoint_completed, checkpoint_total, site_id, sites(name), patrol_routes(name), patrol_templates(name)")
      .in("status", statuses)
      .order("scheduled_start", { ascending: false })
      .limit(8),
    identity,
    siteId,
  );
  const rows = (data ?? []) as any[];
  const title = group === "completed" ? "COMPLETED PATROLS" : group === "incomplete" ? "INCOMPLETE PATROLS" : group === "late" ? "LATE / DELAYED PATROLS" : "MISSED PATROLS";
  const backOptions = [{ id: "patrol_status", label: "Patrol Status" }, { id: "menu", label: "Main Menu" }];
  if (!rows.length) return { title, lines: ["No matching patrols for the active site."], options: backOptions };
  return {
    title,
    lines: [rows.map((row, index) => formatPatrolStatusRow(row, index, group)).join("\n\n")],
    options: backOptions,
  };

}

/** Exported for tests: every patrol line carries the canonical scheduled time. */
export function formatPatrolStatusRow(row: Record<string, any>, index: number, group: string): string {
  const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
  const route = Array.isArray(row.patrol_routes) ? row.patrol_routes[0] : row.patrol_routes;
  const template = Array.isArray(row.patrol_templates) ? row.patrol_templates[0] : row.patrol_templates;
  const scheduled = waTime(row.scheduled_start) ?? "unknown";
  const end = waTime(row.scheduled_end);
  const done = row.checkpoint_completed ?? 0;
  const total = row.checkpoint_total ?? 0;
  const lines = [
    `${index + 1}. ${route?.name ?? template?.name ?? "Patrol"}`,
    `Site: ${site?.name ?? "Unassigned"}`,
    `Date: ${waDate(row.scheduled_start) ?? "unknown"}`,
    `Scheduled: ${scheduled}${end ? ` (window ${scheduled} - ${end})` : ""}`,
    `Status: ${group === "missed" ? "Missed" : String(row.status).replace(/_/g, " ")}`,
  ];
  if (group === "late") {
    const started = waTime(row.actual_start);
    lines.push(`Actual start: ${started ?? "not started"}`);
    const late = lateBy(row.scheduled_start, row.actual_start);
    if (late) lines.push(`Late by: ${late}`);
  }
  if (group !== "missed") {
    lines.push(`Checkpoints: ${done}/${total}${total > done ? ` (${total - done} missed)` : ""}`);
  }
  return lines.join("\n");
}

export async function missedCheckpointsView(client: SupabaseClient, identity: Identity, siteId: string | null): Promise<OutMessage> {
  let query = client
    .from("patrol_session_checkpoints")
    .select("id, status, scheduled_order, scheduled_at, scanned_at, checkpoint_name_snapshot, checkpoints(name), patrol_sessions!inner(id, status, site_id, scheduled_start, patrol_routes(name), sites(name))")
    .eq("company_id", identity.company_id)
    .in("status", ["missed", "overdue"])
    .order("scheduled_at", { ascending: false })
    .limit(10);
  if (siteId) query = query.eq("patrol_sessions.site_id", siteId);
  else if (identity.allowed_site_ids.length) query = query.in("patrol_sessions.site_id", identity.allowed_site_ids);
  const { data, error } = await query;
  if (error) console.error("[WA] missed checkpoints query failed:", error.message);
  const rows = (data ?? []) as any[];
  if (!rows.length) return { title: "MISSED CHECKPOINTS", lines: ["No missed checkpoints for the active site."], options: [{ id: "menu", label: "Main Menu" }] };
  return {
    title: "MISSED CHECKPOINTS",
    lines: [rows.map((row, index) => {
      const checkpoint = Array.isArray(row.checkpoints) ? row.checkpoints[0] : row.checkpoints;
      const session = Array.isArray(row.patrol_sessions) ? row.patrol_sessions[0] : row.patrol_sessions;
      const route = Array.isArray(session?.patrol_routes) ? session.patrol_routes[0] : session?.patrol_routes;
      const site = Array.isArray(session?.sites) ? session.sites[0] : session?.sites;
      const expected = row.scheduled_at ?? session?.scheduled_start ?? null;
      return [
        `${index + 1}. ${checkpoint?.name ?? row.checkpoint_name_snapshot ?? "Checkpoint"}`,
        `Patrol: ${route?.name ?? "Session"}`,
        `Site: ${site?.name ?? "Unassigned"}`,
        `Date: ${waDate(expected) ?? "unknown"}`,
        `Expected: ${waTime(expected) ?? "unknown"}`,
        `Status: ${String(row.status ?? "missed")}`,
      ].join("\n");
    }).join("\n\n")],
    options: [{ id: "reports", label: "Reports" }, { id: "menu", label: "Main Menu" }],
  };
}

/** Secure Patrol Device Mode is restricted to MX Patrol platform owners. */
export function ownerOnlyDenial(): OutMessage {
  return {
    title: "OWNER ACCESS REQUIRED",
    lines: ["Only MX Patrol platform owners can access Secure Patrol Device Mode."],
    options: [{ id: "management", label: "Management Menu" }, { id: "menu", label: "Main Menu" }],
  };
}

function managementOnly(identity: Identity): OutMessage | null {
  if (identity.platformRole === "owner") return null;
  return ownerOnlyDenial();
}

export function secureDeviceMenu(identity: Identity, session: SessionRow): OutMessage {
  const denied = managementOnly(identity);
  if (denied) return denied;
  const kioskOptions = identity.platformRole === "owner" ? [
    { id: "secure_action:request_enable_kiosk_mode", label: "Enable Kiosk Mode" },
    { id: "secure_action:request_disable_kiosk_mode", label: "Disable Kiosk Mode" },
  ] : [];
  return {
    title: "SECURE PATROL DEVICES",
    lines: [session.current_site_name ? "Viewing: " + session.current_site_name : "Choose a site before managing devices.", "What would you like to do?"],
    options: [
      { id: "secure_device_status", label: "Device Status" },
      { id: "secure_device_problems", label: "Security Problems" },
      ...kioskOptions,
      { id: "secure_action:request_device_lock", label: "Lock Device" },
      { id: "secure_action:request_device_disable", label: "Disable Device" },
      { id: "secure_action:request_device_enable", label: "Enable Device" },
      { id: "secure_action:request_maintenance_mode", label: "Maintenance Mode" },
      { id: "secure_action:request_exit_maintenance", label: "Exit Maintenance" },
      { id: "secure_action:request_app_update", label: "Require App Update" },
      { id: "secure_action:request_integrity_check", label: "Security Check" },
      { id: "secure_device_list", label: "Device Info" },
      { id: "secure_action:revoke_device", label: "Revoke Device" },
      { id: "management", label: "Management Menu" },
    ],
  };
}

export async function secureDeviceStatus(client: SupabaseClient, identity: Identity, siteId: string | null): Promise<OutMessage> {
  const denied = managementOnly(identity);
  if (denied) return denied;
  const summary = await getSecureDeviceSummary(client, identity, siteId);
  return {
    title: "DEVICE SECURITY STATUS",
    lines: [
      "Total devices: " + summary.total,
      "Secure devices: " + summary.secure,
      "Attention: " + summary.attention,
      "Disabled: " + summary.disabled,
      "Offline: " + summary.offline,
      "Outdated apps: " + summary.outdated,
      "Kiosk inactive: " + summary.kiosk_disabled,
    ],
    options: [
      { id: "secure_device_list", label: "View Device List" },
      { id: "secure_device_problems", label: "Security Problems" },
      { id: "secure_devices", label: "Main Secure Menu" },
    ],
  };
}

export async function secureDeviceProblems(client: SupabaseClient, identity: Identity, siteId: string | null): Promise<OutMessage> {
  const denied = managementOnly(identity);
  if (denied) return denied;
  const summary = await getSecureDeviceSummary(client, identity, siteId);
  const problemRows = summary.rows.filter((row: Record<string, any>) => deviceSecurityState(row) !== "Secure" || row.status === "offline");
  if (!problemRows.length) {
    return { title: "SECURITY PROBLEMS", lines: ["No secure-device problems found for the active site."], options: [{ id: "secure_devices", label: "Secure Device Menu" }] };
  }
  return {
    title: "SECURITY PROBLEMS",
    lines: [
      "Found " + problemRows.length + " device" + (problemRows.length === 1 ? "" : "s") + " with security issues.",
      "",
      problemRows.slice(0, 6).map((row: Record<string, any>, index: number) => formatDeviceSecurityLine(row, index)).join("\n\n"),
    ],
    options: [
      ...(identity.canManageKiosk && identity.platformRole === "owner"
        ? [{ id: "secure_action:request_enable_kiosk_mode", label: "Enable Kiosk Mode" }]
        : []),
      { id: "secure_action:request_device_lock", label: "Lock Device" },
      { id: "secure_action:request_maintenance_mode", label: "Maintenance Mode" },
      { id: "secure_action:request_app_update", label: "Require App Update" },
      { id: "secure_devices", label: "Main Secure Menu" },
    ],
  };
}

export async function secureDeviceList(client: SupabaseClient, identity: Identity, siteId: string | null, action?: string | null): Promise<OutMessage> {
  const denied = managementOnly(identity);
  if (denied) return denied;
  const rows = await getSecureDeviceRows(client, identity, siteId);
  if (!rows.length) return { title: "SECURE DEVICES", lines: ["No devices are available for the active site."], options: [{ id: "secure_devices", label: "Secure Device Menu" }] };
  return {
    title: action ? "SELECT DEVICE" : "SECURE DEVICES",
    lines: [action ? "Choose the device you want to manage." : "Choose a device for details."],
    options: rows.slice(0, 9).map((row: Record<string, any>) => ({
      id: action ? "secure_action_device:" + action + ":" + row.device_identifier : "secure_info:" + row.device_identifier,
      label: formatSecureDeviceLabel(row) + " - " + deviceSecurityState(row),
    })),
  };
}

export async function secureDeviceInfo(client: SupabaseClient, identity: Identity, siteId: string | null, needle: string): Promise<OutMessage> {
  const denied = managementOnly(identity);
  if (denied) return denied;
  const device = await getSecureDeviceByIdentifier(client, identity, siteId, needle);
  if (!device) return { title: "DEVICE NOT FOUND", lines: ["I could not find that device in the active site."], options: [{ id: "secure_device_list", label: "Secure Device List" }] };
  const events = await getSecureDeviceEvents(client, identity, siteId, String(device.id));
  const eventLines = events.length ? events.slice(0, 4).map((event: Record<string, any>) => "- " + String(event.event_type).replace(/_/g, " ") + " (" + timeAgo(event.occurred_at) + ")") : ["No recent security events."];
  return {
    title: "DEVICE INFO",
    lines: [
      "Device ID: " + (device.device_identifier ?? "Unknown"),
      "Name: " + (device.device_name ?? "Unnamed device"),
      "Status: " + (device.status ?? "unknown"),
      "Device Owner: " + (device.device_owner_active ? "Active" : "Not Provisioned"),
      "Kiosk: " + (device.kiosk_active ? "Locked" : device.device_owner_active ? "Inactive" : "Not Provisioned"),
      "Security: " + deviceSecurityState(device),
      "App Version: " + (device.app_version ?? "unknown"),
      "Last Seen: " + timeAgo(device.last_seen_at),
      "",
      "Recent security events:",
      eventLines.join("\n"),
    ],
    options: [
      ...(identity.canManageKiosk && identity.platformRole === "owner"
        ? [{
            id: "secure_action_device:" +
              (device.kiosk_active ? "request_disable_kiosk_mode" : "request_enable_kiosk_mode") +
              ":" +
              device.device_identifier,
            label: device.kiosk_active ? "Disable Kiosk Mode" : "Enable Kiosk Mode",
          }]
        : []),
      { id: "secure_action_device:request_device_lock:" + device.device_identifier, label: "Lock Device" },
      { id: "secure_action_device:request_maintenance_mode:" + device.device_identifier, label: "Maintenance Mode" },
      { id: "secure_action_device:request_integrity_check:" + device.device_identifier, label: "Security Check" },
      { id: "secure_devices", label: "Main Secure Menu" },
    ],
  };
}


export async function reportCategorySummary(client: SupabaseClient, identity: Identity, siteId: string | null, action: string): Promise<OutMessage> {
  if (action.startsWith("report:device_security:") && identity.platformRole !== "owner") return ownerOnlyDenial();
  const [, category, report] = action.split(":");
  const title = (category + " " + report).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const { data: scans } = await siteFilter<any>(client.from("scan_logs").select("id, tag_status, device_identifier, scanned_at, checkpoints(name)").order("scanned_at", { ascending: false }).limit(200), identity, siteId);
  const { data: sessions } = await siteFilter<any>(client.from("patrol_sessions").select("id, status, scheduled_start, checkpoint_completed, checkpoint_total, patrol_routes(name)").order("scheduled_start", { ascending: false }).limit(100), identity, siteId);
  const { data: alerts } = await siteFilter<any>(client.from("alerts").select("id, type, is_read, created_at, device_identifier").order("created_at", { ascending: false }).limit(100), identity, siteId);
  const { data: incidents } = await siteFilter<any>(client.from("incidents").select("id, resolved, severity, created_at, device_identifier").order("created_at", { ascending: false }).limit(100), identity, siteId);
  const { data: devices } = await siteFilter<any>(client.from("devices").select("id, status, device_identifier, app_version, minimum_app_version, secure_mode_enabled, secure_mode_status, kiosk_active, device_owner_active, developer_mode_detected, adb_detected"), identity, siteId);
  const scanRows = scans ?? [];
  const patrolRows = sessions ?? [];
  const sosRows = (alerts ?? []).filter((row: any) => row.type === "panic_button");
  const incidentRows = incidents ?? [];
  const deviceRows = devices ?? [];
  const completed = patrolRows.filter((row: any) => ["completed", "completed_late"].includes(String(row.status))).length;
  const missed = patrolRows.filter((row: any) => String(row.status) === "missed").length;
  const late = patrolRows.filter((row: any) => ["late", "late_start", "completed_late"].includes(String(row.status))).length;
  const unregistered = scanRows.filter((row: any) => String(row.tag_status ?? "").includes("unregistered") || String(row.tag_status ?? "").includes("unknown")).length;
  const duplicate = scanRows.filter((row: any) => String(row.tag_status ?? "").includes("duplicate")).length;
  const offlineSynced = scanRows.filter((row: any) => String(row.tag_status ?? "").includes("offline")).length;
  if (category === "checkpoint_activity") {
    const registered = scanRows.filter((row: any) => String(row.tag_status ?? "registered").includes("registered")).length;
    const latest = scanRows.slice(0, 5).map((row: any, index: number) => {
      const checkpoint = Array.isArray(row.checkpoints) ? row.checkpoints[0] : row.checkpoints;
      return `${index + 1}. ${checkpoint?.name ?? "Unknown checkpoint"} - ${row.device_identifier ?? "Unknown device"} - ${waTime(row.scanned_at) ?? "unknown"}`;
    });
    return {
      title: "CHECKPOINT ACTIVITY",
      lines: [
        `Site: ${siteId ? "selected site" : "allowed sites"}`,
        `Total scans: ${scanRows.length}`,
        `Registered scans: ${registered}`,
        `Exceptions: ${scanRows.length - registered}`,
        "",
        latest.length ? latest.join("\n") : "No checkpoint activity found.",
      ],
      options: [{ id: "reports", label: "Reports" }, { id: "menu", label: "Main Menu" }],
    };
  }

  if (category === "scan_investigations") {
    const { data: investigations } = await siteFilter<any>(client.from("scan_investigations").select("id, investigation_type, registered_status, status, reason, scanned_at, device_identifier").order("scanned_at", { ascending: false }).limit(100), identity, siteId);
    const investigationRows = (investigations ?? []) as any[];
    const pending = investigationRows.filter((row: any) => row.status === "pending").length;
    const resolved = investigationRows.filter((row: any) => row.status === "resolved").length;
    const byType = investigationRows.reduce((acc: Record<string, number>, row: any) => {
      const key = String(row.investigation_type ?? "other").replace(/_/g, " ");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const typeSummary = Object.entries(byType).map(([key, value]) => String(key) + " " + String(value)).join(", ") || "none";
    const latest = investigationRows.slice(0, 5).map((row: any, index: number) => `${index + 1}. ${String(row.investigation_type ?? "other").replace(/_/g, " ")} - ${row.device_identifier ?? "Unknown device"} - ${row.status}`);
    return {
      title: "SCAN INVESTIGATIONS",
      lines: [
        `Site: ${siteId ? "selected site" : "allowed sites"}`,
        `Total investigations: ${investigationRows.length}`,
        `Pending review: ${pending}`,
        `Resolved: ${resolved}`,
        `By type: ${typeSummary}`,
        "",
        latest.length ? latest.join("\n") : "No scan investigations found.",
      ],
      options: [{ id: "reports", label: "Reports" }, { id: "menu", label: "Main Menu" }],
    };
  }

  const lines = [
    `Site: ${siteId ? "selected site" : "allowed sites"}`,
    `Checkpoint scans: ${scanRows.length} (${unregistered} unregistered, ${duplicate} duplicate, ${offlineSynced} offline synced)`,
    `Patrol sessions: ${patrolRows.length} (${completed} completed, ${late} late/delayed, ${missed} missed)`,
    `SOS alerts: ${sosRows.length} (${sosRows.filter((row: any) => !row.is_read).length} active)`,
    `Incidents: ${incidentRows.length} (${incidentRows.filter((row: any) => !row.resolved).length} open)`,
    `Devices: ${deviceRows.length} (${deviceRows.filter((row: any) => row.status === "online").length} online, ${deviceRows.filter((row: any) => row.status === "offline").length} offline)`,
  ];
  if (category === "device_security") {
    lines.push(`Kiosk inactive: ${deviceRows.filter((row: any) => row.device_owner_active && !row.kiosk_active).length}`);
    lines.push(`Integrity failures: ${deviceRows.filter((row: any) => String(row.secure_mode_status ?? "").includes("fail") || row.developer_mode_detected || row.adb_detected).length}`);
  }
  return { title: title.toUpperCase(), lines, options: [{ id: "reports", label: "Reports" }, { id: "menu", label: "Main Menu" }] };
}
// ===== Context-aware menu state (kept here so it deploys with the function bundle) =====

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
  management_whatsapp: {
    title: "WHATSAPP MANAGEMENT",
    menuKey: "management_whatsapp",
    lines: ["Manage WhatsApp assistant access."],
    options: [
      { id: "authorize_whatsapp", label: "Authorize WhatsApp Number" },
      { id: "view_whatsapp_numbers", label: "View Authorized Numbers" },
      { id: "revoke_whatsapp_access", label: "Revoke WhatsApp Access" },
      { id: "back", label: "Back" },
    ],
  },
  reports_period: {
    title: "DAILY / WEEKLY SUMMARY",
    menuKey: "reports_period",
    lines: ["Choose a time period."],
    options: [
      { id: "today", label: "Today Summary" },
      { id: "yesterday", label: "Yesterday Summary" },
      { id: "week", label: "This Week Summary" },
      { id: "problems", label: "Problems Only" },
      { id: "back", label: "Back" },
    ],
  },
  reports_checkpoint_activity: reportMenu("CHECKPOINT ACTIVITY", "reports_checkpoint_activity", [
    { id: "report:checkpoint_activity:summary", label: "Activity Summary" },
    { id: "report:checkpoint_activity:checkpoint", label: "By Checkpoint" },
    { id: "report:checkpoint_activity:device", label: "By Device" },
    { id: "back", label: "Back" },
  ]),
  reports_scan_investigations: reportMenu("SCAN INVESTIGATIONS", "reports_scan_investigations", [
    { id: "report:scan_investigations:summary", label: "Investigation Summary" },
    { id: "report:scan_investigations:pending", label: "Pending Review" },
    { id: "report:scan_investigations:type", label: "By Type" },
    { id: "back", label: "Back" },
  ]),
  reports_checkpoint_scans: reportMenu("CHECKPOINT SCAN REPORTS", "reports_checkpoint_scans", [
    { id: "report:checkpoint_scans:site_time", label: "Scans by Site / Date / Time" },
    { id: "report:checkpoint_scans:checkpoint", label: "Scans by Checkpoint" },
    { id: "report:checkpoint_scans:matrix", label: "Checkpoint Time Matrix" },
    { id: "report:checkpoint_scans:device", label: "Scans by Device" },
    { id: "report:checkpoint_scans:unregistered", label: "Unregistered Tags" },
    { id: "report:checkpoint_scans:duplicate", label: "Duplicate Scans" },
    { id: "report:checkpoint_scans:offline_synced", label: "Offline Synced Scans" },
    { id: "back", label: "Back" },
  ]),
  reports_patrols: reportMenu("PATROL REPORTS", "reports_patrols", [
    { id: "report:patrols:summary", label: "Patrol Summary" },
    { id: "report:patrols:details", label: "Patrol Session Details" },
    { id: "report:patrols:performance", label: "Patrol Performance" },
    { id: "report:patrols:timeline", label: "Patrol Timeline" },
    { id: "missed_checkpoints", label: "Missed Checkpoints" },
    { id: "late_patrols", label: "Late / Delayed Sessions" },
    { id: "back", label: "Back" },
  ]),
  reports_sos: reportMenu("SOS REPORTS", "reports_sos", [
    { id: "report:sos:summary", label: "SOS Summary" },
    { id: "report:sos:active", label: "Active SOS" },
    { id: "report:sos:resolved", label: "Resolved SOS" },
    { id: "report:sos:device", label: "SOS by Device" },
    { id: "report:sos:site", label: "SOS by Site" },
    { id: "report:sos:response_times", label: "Response Times" },
    { id: "back", label: "Back" },
  ]),
  reports_incidents: reportMenu("INCIDENT REPORTS", "reports_incidents", [
    { id: "report:incidents:summary", label: "Incident Summary" },
    { id: "incidents", label: "Open Incidents" },
    { id: "report:incidents:high", label: "High Priority" },
    { id: "report:incidents:resolved", label: "Resolved Incidents" },
    { id: "report:incidents:site", label: "Incidents by Site" },
    { id: "report:incidents:device", label: "Incidents by Device" },
    { id: "back", label: "Back" },
  ]),
  reports_data_logs: reportMenu("DATALOG REPORT", "reports_data_logs", [
    { id: "report:data_logs:values", label: "Datalog Values" },
    { id: "menu:reports", label: "Back" },
  ]),
  reports_devices: reportMenu("DEVICE REPORTS", "reports_devices", [
    { id: "report:devices:summary", label: "Device Summary" },
    { id: "report:devices:online", label: "Online Devices" },
    { id: "offline", label: "Offline Devices" },
    { id: "report:devices:activity", label: "Device Activity" },
    { id: "report:devices:patrol_activity", label: "Device Patrol Activity" },
    { id: "report:devices:app_versions", label: "App Version Status" },
    { id: "report:devices:disabled", label: "Disabled/Revoked Devices" },
    { id: "back", label: "Back" },
  ]),
  reports_checkpoint_performance: reportMenu("CHECKPOINT PERFORMANCE", "reports_checkpoint_performance", [
    { id: "report:checkpoint_performance:most_scanned", label: "Most Scanned" },
    { id: "report:checkpoint_performance:least_scanned", label: "Least Scanned" },
    { id: "report:checkpoint_performance:missed_rate", label: "Missed Checkpoint Rate" },
    { id: "report:checkpoint_performance:repeatedly_missed", label: "Repeatedly Missed Checkpoints" },
    { id: "report:checkpoint_performance:timing", label: "Average Scan Timing" },
    { id: "back", label: "Back" },
  ]),
  reports_schedules: reportMenu("SCHEDULE REPORTS", "reports_schedules", [
    { id: "report:schedules:summary", label: "Schedule Summary" },
    { id: "report:schedules:active", label: "Active Schedules" },
    { id: "report:schedules:paused", label: "Paused Schedules" },
    { id: "missed_patrols", label: "Missed Scheduled Sessions" },
    { id: "late_patrols", label: "Late Starts" },
    { id: "report:schedules:completion_rate", label: "Completion Rate" },
    { id: "back", label: "Back" },
  ]),
  reports_routes: reportMenu("ROUTE REPORTS", "reports_routes", [
    { id: "report:routes:summary", label: "Route Summary" },
    { id: "report:routes:usage", label: "Route Usage" },
    { id: "report:routes:completion_rate", label: "Route Completion Rate" },
    { id: "report:routes:missed_checkpoints", label: "Missed Checkpoints by Route" },
    { id: "report:routes:duration", label: "Average Route Duration" },
    { id: "report:routes:schedules", label: "Schedules Using Route" },
    { id: "back", label: "Back" },
  ]),
  reports_device_security: reportMenu("DEVICE SECURITY REPORTS", "reports_device_security", [
    { id: "report:device_security:summary", label: "Security Summary" },
    { id: "report:device_security:kiosk_inactive", label: "Kiosk Inactive" },
    { id: "report:device_security:outdated_apps", label: "Outdated Apps" },
    { id: "report:device_security:integrity_failures", label: "Integrity Failures" },
    { id: "report:device_security:disabled", label: "Disabled Devices" },
    { id: "report:device_security:command_history", label: "Security Command History" },
    { id: "report:device_security:maintenance", label: "Maintenance Sessions" },
    { id: "back", label: "Back" },
  ]),
  management_reports: {
    title: "REPORTS",
    menuKey: "management_reports",
    lines: ["Please choose a report category:"],
    options: reportRootOptions({ platformRole: "owner" } as Identity),
  },
};

export const WA_MENU_PARENTS: Record<string, string> = {
  management_operations: MANAGEMENT_HOME_KEY,
  management_devices: MANAGEMENT_HOME_KEY,
  management_checkpoints: MANAGEMENT_HOME_KEY,
  management_incidents: MANAGEMENT_HOME_KEY,
  management_patrol_config: MANAGEMENT_HOME_KEY,
  management_reports: MANAGEMENT_HOME_KEY,
  management_whatsapp: MANAGEMENT_HOME_KEY,
  reports_period: "report_period",
  reports_checkpoint_activity: "report_period",
  reports_scan_investigations: "report_period",
  reports_checkpoint_scans: "report_period",
  reports_patrols: "report_period",
  reports_sos: "report_period",
  reports_incidents: "report_period",
  reports_data_logs: "report_period",
  reports_devices: "report_period",
  reports_checkpoint_performance: "report_period",
  reports_schedules: "report_period",
  reports_routes: "report_period",
  reports_device_security: "report_period",
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






