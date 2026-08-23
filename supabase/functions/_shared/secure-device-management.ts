// Shared helpers for secure patrol device management (used by the WhatsApp webhook
// and any other edge function that needs device security state or remote commands).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

export type SecureDeviceAction =
  | "request_device_lock"
  | "request_device_disable"
  | "request_device_enable"
  | "request_maintenance_mode"
  | "request_exit_maintenance"
  | "request_app_update"
  | "request_integrity_check"
  | "revoke_device";

export type SecureDeviceRow = Record<string, any>;

type Scope = { company_id: string; allowed_site_ids?: string[] };

const MIN_APP_VERSION = "1.0.0";

const COMMAND_MAP: Record<SecureDeviceAction, { command_type: string; payload?: Record<string, unknown> }> = {
  request_device_lock: { command_type: "lock_device" },
  request_device_disable: { command_type: "set_kiosk_mode", payload: { enabled: false, disabled: true } },
  request_device_enable: { command_type: "set_kiosk_mode", payload: { enabled: true, disabled: false } },
  request_maintenance_mode: { command_type: "update_policy", payload: { maintenance_mode: true } },
  request_exit_maintenance: { command_type: "update_policy", payload: { maintenance_mode: false } },
  request_app_update: { command_type: "install_app" },
  request_integrity_check: { command_type: "update_policy", payload: { integrity_check: true } },
  revoke_device: { command_type: "wipe_device" },
};

function compareVersions(a: string, b: string): number {
  const left = String(a).split(".").map((part) => Number(part) || 0);
  const right = String(b).split(".").map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalize(row: SecureDeviceRow): SecureDeviceRow {
  const meta = (row?.metadata ?? {}) as Record<string, any>;
  return {
    ...row,
    app_version: meta.app_version ?? row.app_version ?? null,
    kiosk_active: Boolean(meta.kiosk_active ?? meta.kiosk_mode ?? false),
    developer_mode: Boolean(meta.developer_mode ?? false),
    maintenance_mode: Boolean(meta.maintenance_mode ?? false),
    site: row?.sites?.name ?? meta.site_name ?? row.site_location ?? "Unassigned",
  };
}

/** Human readable security state for a device row. */
export function deviceSecurityState(row: SecureDeviceRow): string {
  const device = normalize(row);
  if (device.pairing_status === "revoked") return "Revoked";
  if (device.maintenance_mode) return "Maintenance";
  if (device.developer_mode) return "Developer mode";
  if (device.app_version && compareVersions(device.app_version, MIN_APP_VERSION) < 0) return "Outdated app";
  if (!device.kiosk_active) return "Kiosk inactive";
  if (device.status === "offline") return "Offline";
  return "Secure";
}

export function formatSecureDeviceLabel(row: SecureDeviceRow): string {
  const device = normalize(row);
  const name = device.device_name ? " - " + device.device_name : "";
  return String(device.device_identifier ?? "Unknown") + name;
}

export function formatDeviceSecurityLine(row: SecureDeviceRow, index: number): string {
  const device = normalize(row);
  return [
    (index + 1) + ". " + formatSecureDeviceLabel(device),
    "   Site: " + device.site,
    "   Security: " + deviceSecurityState(device),
    "   App: " + (device.app_version ?? "unknown") + " | Kiosk: " + (device.kiosk_active ? "Locked" : "Inactive"),
  ].join("\n");
}

function scopedDeviceQuery(client: SupabaseClient, scope: Scope, siteId: string | null) {
  let query = client
    .from("devices")
    .select("id, company_id, site_id, device_identifier, device_name, device_type, status, pairing_status, last_seen_at, battery_level, metadata, site_location, sites(name)")
    .eq("company_id", scope.company_id)
    .order("device_identifier");
  if (siteId) query = query.eq("site_id", siteId);
  else if (scope.allowed_site_ids?.length) query = query.in("site_id", scope.allowed_site_ids);
  return query;
}

export async function getSecureDeviceRows(
  client: SupabaseClient,
  scope: Scope,
  siteId: string | null,
): Promise<SecureDeviceRow[]> {
  const { data, error } = await scopedDeviceQuery(client, scope, siteId).limit(100);
  if (error) {
    console.error("[secure-devices] list failed:", error.message);
    return [];
  }
  return (data ?? []).map(normalize);
}

export async function getSecureDeviceSummary(client: SupabaseClient, scope: Scope, siteId: string | null) {
  const rows = await getSecureDeviceRows(client, scope, siteId);
  const state = rows.map((row) => ({ row, state: deviceSecurityState(row) }));
  return {
    rows,
    total: rows.length,
    secure: state.filter((entry) => entry.state === "Secure").length,
    attention: state.filter((entry) => entry.state !== "Secure" && entry.state !== "Revoked").length,
    disabled: rows.filter((row) => row.pairing_status === "revoked").length,
    offline: rows.filter((row) => row.status === "offline").length,
    outdated: rows.filter((row) => row.app_version && compareVersions(row.app_version, MIN_APP_VERSION) < 0).length,
    kiosk_disabled: rows.filter((row) => !row.kiosk_active).length,
  };
}

export async function getSecureDeviceByIdentifier(
  client: SupabaseClient,
  scope: Scope,
  siteId: string | null,
  needle: string,
): Promise<SecureDeviceRow | null> {
  const rows = await getSecureDeviceRows(client, scope, siteId);
  const value = String(needle ?? "").trim().toLowerCase();
  if (!value) return null;
  return (
    rows.find((row) => String(row.device_identifier ?? "").toLowerCase() === value) ??
    rows.find((row) => String(row.device_identifier ?? "").toLowerCase().includes(value)) ??
    rows.find((row) => String(row.device_name ?? "").toLowerCase().includes(value)) ??
    null
  );
}

export async function getSecureDeviceEvents(
  client: SupabaseClient,
  scope: Scope,
  _siteId: string | null,
  deviceId: string,
): Promise<Array<Record<string, any>>> {
  const { data, error } = await client
    .from("device_activity_logs")
    .select("id, action, metadata, created_at")
    .eq("company_id", scope.company_id)
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[secure-devices] events failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({ ...row, event_type: row.action, occurred_at: row.created_at }));
}

export async function requestSecureDeviceCommand(
  client: SupabaseClient,
  scope: Scope & { user_id?: string | null },
  siteId: string | null,
  action: SecureDeviceAction,
  deviceIdentifier: string,
  payload: Record<string, unknown> = {},
  source = "api",
): Promise<{ device: SecureDeviceRow; queued: boolean; command: Record<string, any> | null }> {
  const device = await getSecureDeviceByIdentifier(client, scope, siteId, deviceIdentifier);
  if (!device) throw new Error("Device " + deviceIdentifier + " was not found for this site.");

  const mapping = COMMAND_MAP[action];
  if (!mapping) throw new Error("Unsupported secure device action.");

  const { data: command, error } = await client
    .from("device_commands")
    .insert({
      device_id: device.id,
      company_id: scope.company_id,
      command_type: mapping.command_type,
      status: "pending",
      payload: { ...(mapping.payload ?? {}), ...payload, secure_action: action, source },
      issued_by: scope.user_id ?? null,
    })
    .select("id, command_type, status, issued_at")
    .maybeSingle();

  if (error) throw new Error("Could not queue the secure command: " + error.message);

  await client.from("device_activity_logs").insert({
    device_id: device.id,
    company_id: scope.company_id,
    action: "command_sent",
    performed_by: scope.user_id ?? null,
    metadata: { secure_action: action, source, command_id: command?.id ?? null, payload },
  });

  if (action === "revoke_device") {
    await client.from("devices").update({ pairing_status: "revoked" }).eq("id", device.id);
  }

  return { device, queued: device.status !== "online", command: command ?? null };
}
