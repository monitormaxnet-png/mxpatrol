import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import type { Identity, OutMessage, SessionRow } from "./types.ts";
import { greeting, timeAgo } from "./types.ts";

function siteFilter<T>(query: any, identity: Identity, siteId: string | null) {
  let next = query.eq("company_id", identity.company_id);
  if (siteId) next = next.eq("site_id", siteId);
  else if (identity.allowed_site_ids.length) next = next.in("site_id", identity.allowed_site_ids);
  return next as T;
}

export function mainMenu(identity: Identity, session: SessionRow): OutMessage {
  const context = session.current_site_name ? `Viewing: ${session.current_site_name}` : "Choose a site to continue.";
  return {
    title: "MX PATROL",
    lines: [
      `${greeting()} 👋`,
      context,
      "What would you like to do?",
    ],
    options: [
      { id: "live", label: "Live Now" },
      { id: "attention", label: "Attention" },
      { id: "devices", label: "Devices" },
      { id: "incidents", label: "Incidents" },
      { id: "reports", label: "Reports" },
      { id: "completed_patrols", label: "Completed Patrols" },
      { id: "incomplete_patrols", label: "Incomplete Patrols" },
      { id: "late_patrols", label: "Late / Delayed Patrols" },
      { id: "missed_patrols", label: "Missed Patrols" },
      { id: "missed_checkpoints", label: "Missed Checkpoints List" },
      { id: "change_site", label: "Change Site" },
      { id: "menu", label: "Main Menu" },
    ],
    footer: "You can also ask me something like:\nWhich devices are offline?",
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
    title: "MX PATROL — MANAGEMENT",
    lines: [session.current_site_name ? `Viewing: ${session.current_site_name}` : "Choose a site before making changes.", "What would you like to do?"],
    options: [
      { id: "register_device", label: "Register Device" },
      { id: "add_checkpoint", label: "Register Checkpoint" },
      { id: "report_incident", label: "Register Incident" },
      { id: "devices", label: "View Devices" },
      { id: "checkpoints", label: "View Checkpoints" },
      { id: "incidents", label: "View Incidents" },
      { id: "patrols", label: "Patrol Management" },
      { id: "reports", label: "Reports" },
      { id: "change_site", label: "Change Site" },
      { id: "user", label: "User Assistant" },
      { id: "menu", label: "Main Menu" },
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
      `🟢 ${active} devices active`,
      `🚶 ${(sessions ?? []).length} patrols in progress`,
      `⚠️ ${attention} item${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} attention`,
      `🆘 ${sos} SOS alert${sos === 1 ? "" : "s"}`,
    ],
    options: [
      { id: "patrols", label: "View Active Patrols" },
      { id: "devices", label: "View Devices" },
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
        `📱 ${row.device_identifier ?? "No device"}`,
        `🟢 ${String(row.status).replace(/_/g, " ")}`,
        `✅ ${row.checkpoint_completed ?? 0} / ${row.checkpoint_total ?? 0} checkpoints`,
        `⏱ Last activity: ${timeAgo(row.last_scan_at)}`,
      ].join("\n"),
    );
  }

  return {
    title: "ACTIVE PATROLS",
    lines: [lines.join("\n\n")],
    options: [
      { id: "devices", label: "View Devices" },
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
    return { title: "ATTENTION", lines: ["✅ Nothing needs attention right now."], options: [{ id: "menu", label: "Main Menu" }] };
  }

  const counts = {
    critical: rows.filter((r) => r.severity === "critical").length,
    medium: rows.filter((r) => r.severity === "medium" || r.severity === "high").length,
    low: rows.filter((r) => r.severity === "low" || !r.severity).length,
  };

  const detail = rows
    .slice(0, 5)
    .map((row) => {
      const icon = row.type === "panic_button" ? "🔴" : row.type === "device_offline" ? "📴" : "⚠️";
      return `${icon} ${row.message}\n⏱ ${timeAgo(row.created_at)}`;
    })
    .join("\n\n");

  const options = [
    { id: "sos", label: "SOS Alerts" },
    { id: "missed", label: "Missed Checkpoints" },
    { id: "offline", label: "Offline Devices" },
  ];
  if (filter === "sos" && identity.canAcknowledge) options.unshift({ id: "ack", label: "Acknowledge All SOS" });

  return {
    title: `⚠️ ${rows.length} ITEM${rows.length === 1 ? "" : "S"} NEED ATTENTION`,
    lines: [
      `🔴 ${counts.critical} Critical`,
      `🟠 ${counts.medium} Medium`,
      `🔵 ${counts.low} Low`,
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
      `🟢 Online: ${online}`,
      `🔴 Offline: ${offline}`,
      "",
      rows.length ? "Choose a device:" : "No devices registered yet.",
    ],
    options: rows.map((row) => ({
      id: `device:${row.device_identifier}`,
      label: `${row.device_identifier} — ${row.status === "online" ? "Online" : "Offline"}`,
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
        lines: [`I couldn't find a device matching “${needle}”.`],
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
        device.status === "online" ? "🟢 Online" : "🔴 Offline",
        "",
        `Site: ${site?.name ?? "Unassigned"}`,
        `Last seen: ${timeAgo(device.last_seen_at)}`,
        `Last checkpoint: ${lastCheckpoint ?? "None yet"}`,
        route?.name ? `Patrol: ${route.name}` : "Patrol: None",
        session ? `Progress: ${session.checkpoint_completed ?? 0}/${session.checkpoint_total ?? 0}` : "Progress: —",
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
        label: `${device.device_identifier} — ${site?.name ?? "Unknown site"}`,
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
      ? [rows.map((r) => `${r.resolved ? "✅" : "🟠"} ${r.title}\n${String(r.severity).toUpperCase()} · ${timeAgo(r.created_at)}`).join("\n\n")]
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
      if (device.status === "offline") problems.push(`• ${device.device_identifier} offline`);
    }
    for (const session of sessionRows) {
      const done = session.checkpoint_completed ?? 0;
      const total = session.checkpoint_total ?? 0;
      if (total > 0 && done < total) {
        const site = Array.isArray(session.sites) ? session.sites[0] : session.sites;
        const route = Array.isArray(session.patrol_routes) ? session.patrol_routes[0] : session.patrol_routes;
        problems.push(`• ${site?.name ?? route?.name ?? "Patrol"} completed ${done}/${total} checkpoints`);
      }
    }
    for (const alert of (alerts ?? []) as any[]) {
      if (alert.type === "missed_checkpoint") problems.push(`• ${alert.message}`);
    }

    return {
      title: problems.length ? `⚠️ ${problems.length} things need attention` : "✅ Nothing went wrong",
      lines: problems.length ? [problems.slice(0, 12).join("\n")] : ["Everything completed normally."],
      options: [{ id: "reports", label: "Reports" }, { id: "menu", label: "Main Menu" }],
    };
  }

  return {
    title: `${label}'S SECURITY SUMMARY`,
    lines: [
      `📱 Devices active: ${((devices ?? []) as any[]).filter((d) => d.status === "online").length}`,
      `🚶 Patrols completed: ${completed}`,
      `✅ Checkpoints scanned: ${(scans ?? []).length}`,
      `⚠️ Missed checkpoints: ${missedCheckpoints}`,
      `🚨 Incidents: ${(incidents ?? []).length}`,
      `🆘 SOS alerts: ${sos}`,
    ],
    options: [
      { id: "problems", label: "Problems Only" },
      { id: "reports", label: "Change Period" },
      { id: "menu", label: "Main Menu" },
    ],
  };
}

export function reportPeriodMenu(): OutMessage {
  return {
    title: "WHAT HAPPENED?",
    lines: ["Choose a period."],
    options: [
      { id: "today", label: "Today" },
      { id: "yesterday", label: "Yesterday" },
      { id: "week", label: "This Week" },
    ],
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
      .select("id, status, scheduled_start, actual_start, checkpoint_completed, checkpoint_total, site_id, sites(name), patrol_routes(name)")
      .in("status", statuses)
      .order("scheduled_start", { ascending: false })
      .limit(8),
    identity,
    siteId,
  );
  const rows = (data ?? []) as any[];
  const title = group === "completed" ? "COMPLETED PATROLS" : group === "incomplete" ? "INCOMPLETE PATROLS" : group === "late" ? "LATE / DELAYED PATROLS" : "MISSED PATROLS";
  if (!rows.length) return { title, lines: ["No matching patrols for the active site."], options: [{ id: "menu", label: "Main Menu" }] };
  return {
    title,
    lines: [rows.map((row, index) => {
      const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
      const route = Array.isArray(row.patrol_routes) ? row.patrol_routes[0] : row.patrol_routes;
      const scheduled = row.scheduled_start ? new Date(row.scheduled_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }) : "unknown";
      const started = row.actual_start ? new Date(row.actual_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }) : "not started";
      return `${index + 1}. ${route?.name ?? site?.name ?? "Patrol"}\nStatus: ${String(row.status).replace(/_/g, " ")}\nScheduled: ${scheduled}\nStarted: ${started}\nCheckpoints: ${row.checkpoint_completed ?? 0}/${row.checkpoint_total ?? 0}`;
    }).join("\n\n")],
    options: [{ id: "menu", label: "Main Menu" }],
  };
}

export async function missedCheckpointsView(client: SupabaseClient, identity: Identity, siteId: string | null): Promise<OutMessage> {
  let query = client
    .from("patrol_session_checkpoints")
    .select("id, status, sequence_order, expected_scan_at, scanned_at, site_id, checkpoint_name, checkpoints(name), patrol_sessions(id, status, scheduled_start, patrol_routes(name), sites(name))")
    .eq("company_id", identity.company_id)
    .in("status", ["missed", "overdue"])
    .order("expected_scan_at", { ascending: false })
    .limit(10);
  if (siteId) query = query.eq("site_id", siteId);
  else if (identity.allowed_site_ids.length) query = query.in("site_id", identity.allowed_site_ids);
  const { data } = await query;
  const rows = (data ?? []) as any[];
  if (!rows.length) return { title: "MISSED CHECKPOINTS", lines: ["No missed checkpoints for the active site."], options: [{ id: "menu", label: "Main Menu" }] };
  return {
    title: "MISSED CHECKPOINTS",
    lines: [rows.map((row, index) => {
      const checkpoint = Array.isArray(row.checkpoints) ? row.checkpoints[0] : row.checkpoints;
      const session = Array.isArray(row.patrol_sessions) ? row.patrol_sessions[0] : row.patrol_sessions;
      const route = Array.isArray(session?.patrol_routes) ? session.patrol_routes[0] : session?.patrol_routes;
      const when = row.expected_scan_at ? new Date(row.expected_scan_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }) : "unknown time";
      return `${index + 1}. ${checkpoint?.name ?? row.checkpoint_name ?? "Checkpoint"}\nPatrol: ${route?.name ?? "Session"}\nExpected: ${when}`;
    }).join("\n\n")],
    options: [{ id: "reports", label: "Reports" }, { id: "menu", label: "Main Menu" }],
  };
}
