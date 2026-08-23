// Shared helpers for secure patrol device management (used by WhatsApp and Edge Functions).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

export type SecureDeviceAction =
  | "get_secure_device_summary"
  | "get_device_security_status"
  | "get_device_security_details"
  | "get_device_security_events"
  | "request_device_lock"
  | "request_device_disable"
  | "request_device_enable"
  | "request_maintenance_mode"
  | "request_exit_maintenance"
  | "request_app_update"
  | "request_integrity_check"
  | "revoke_device";

export type SecureDeviceActor = {
  company_id: string;
  user_id?: string | null;
  role?: string | null;
  canManage?: boolean;
  allowed_site_ids?: string[];
};

export type SecureDeviceRow = Record<string, any>;

const COMMAND_TYPES: Partial<Record<SecureDeviceAction, string>> = {
  request_device_lock: "lock_device",
  request_device_disable: "disable_device",
  request_device_enable: "enable_device",
  request_maintenance_mode: "enter_maintenance",
  request_exit_maintenance: "exit_maintenance",
  request_app_update: "require_app_update",
  request_integrity_check: "force_security_check",
  revoke_device: "revoke_device",
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return mins + " min ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

function compareVersions(a: string, b: string): number {
  const left = String(a).split(".").map((part) => Number(part) || 0);
  const right = String(b).split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeDevice(row: SecureDeviceRow): SecureDeviceRow {
  const meta = (row?.metadata ?? {}) as Record<string, any>;
  const site = Array.isArray(row?.sites) ? row.sites[0] : row?.sites;
  return {
    ...row,
    app_version: row.app_version ?? meta.app_version ?? null,
    minimum_app_version: row.minimum_app_version ?? meta.minimum_app_version ?? null,
    kiosk_active: Boolean(row.kiosk_active ?? meta.kiosk_active ?? meta.kiosk_mode ?? false),
    developer_mode_detected: Boolean(row.developer_mode_detected ?? meta.developer_mode ?? false),
    adb_detected: Boolean(row.adb_detected ?? meta.adb_detected ?? false),
    maintenance_expires_at: row.maintenance_expires_at ?? meta.maintenance_expires_at ?? null,
    secure_mode_status: row.secure_mode_status ?? meta.secure_mode_status ?? null,
    secure_mode_enabled: Boolean(row.secure_mode_enabled ?? meta.secure_mode_enabled ?? meta.kiosk_mode ?? false),
    site: site?.name ?? meta.site_name ?? row.site_location ?? "Unassigned",
  };
}

export function assertCanManageSecureDevices(actor: SecureDeviceActor) {
  if (!actor.canManage && actor.role !== "admin" && actor.role !== "supervisor") {
    throw new Error("Management access required");
  }
}

function scopedDeviceQuery(client: SupabaseClient, actor: SecureDeviceActor, siteId: string | null) {
  let query = client
    .from("devices")
    .select("id, company_id, site_id, device_identifier, device_name, device_type, status, pairing_status, last_seen_at, battery_level, metadata, site_location, secure_mode_enabled, secure_mode_status, app_version, minimum_app_version, device_owner_active, kiosk_active, developer_mode_detected, adb_detected, last_integrity_check_at, maintenance_expires_at, sites(name)")
    .eq("company_id", actor.company_id)
    .order("device_identifier", { ascending: true });
  if (siteId) query = query.eq("site_id", siteId);
  else if (actor.allowed_site_ids?.length) query = query.in("site_id", actor.allowed_site_ids);
  return query;
}

export async function getSecureDeviceRows(
  client: SupabaseClient,
  actor: SecureDeviceActor,
  siteId: string | null,
): Promise<SecureDeviceRow[]> {
  assertCanManageSecureDevices(actor);
  const { data, error } = await scopedDeviceQuery(client, actor, siteId).limit(100);
  if (error) throw error;
  return (data ?? []).map(normalizeDevice);
}

export function deviceSecurityState(row: SecureDeviceRow): string {
  const device = normalizeDevice(row);
  if (device.pairing_status === "revoked" || device.secure_mode_status === "revoked") return "Revoked";
  if (device.secure_mode_status === "disabled") return "Disabled";
  if (device.secure_mode_status === "maintenance" || device.maintenance_expires_at) return "Maintenance";
  if (device.secure_mode_status === "update_required") return "Update Required";
  if (device.secure_mode_status === "integrity_failed") return "Integrity Failure";
  if (device.developer_mode_detected || device.adb_detected) return "Attention";
  if (device.minimum_app_version && device.app_version && compareVersions(device.app_version, device.minimum_app_version) < 0) return "Outdated app";
  if (device.secure_mode_enabled && !device.kiosk_active) return "Kiosk Inactive";
  if (device.status === "offline") return "Offline";
  if (device.secure_mode_enabled || device.kiosk_active) return "Secure";
  return "Attention";
}

export function isDeviceAttention(row: SecureDeviceRow): boolean {
  const device = normalizeDevice(row);
  const state = deviceSecurityState(device);
  const offlineLong = device.status === "offline" && device.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() > 24 * 60 * 60 * 1000;
  return state !== "Secure" || Boolean(offlineLong);
}

export async function getSecureDeviceSummary(client: SupabaseClient, actor: SecureDeviceActor, siteId: string | null) {
  const rows = await getSecureDeviceRows(client, actor, siteId);
  return {
    rows,
    total: rows.length,
    secure: rows.filter((row) => deviceSecurityState(row) === "Secure").length,
    attention: rows.filter(isDeviceAttention).length,
    disabled: rows.filter((row) => row.secure_mode_status === "disabled" || row.pairing_status === "revoked").length,
    offline: rows.filter((row) => row.status === "offline").length,
    outdated: rows.filter((row) => row.minimum_app_version && row.app_version && compareVersions(row.app_version, row.minimum_app_version) < 0).length,
    kiosk_disabled: rows.filter((row) => row.secure_mode_enabled && !row.kiosk_active).length,
    integrity_failures: rows.filter((row) => row.secure_mode_status === "integrity_failed").length,
  };
}

export async function getSecureDeviceByIdentifier(
  client: SupabaseClient,
  actor: SecureDeviceActor,
  siteId: string | null,
  needle: string,
): Promise<SecureDeviceRow | null> {
  const rows = await getSecureDeviceRows(client, actor, siteId);
  const value = String(needle ?? "").trim().toLowerCase();
  if (!value) return null;
  return rows.find((row) => String(row.device_identifier ?? "").toLowerCase() === value)
    ?? rows.find((row) => String(row.device_identifier ?? "").toLowerCase().includes(value))
    ?? rows.find((row) => String(row.device_name ?? "").toLowerCase().includes(value))
    ?? null;
}

export async function requestSecureDeviceCommand(
  client: SupabaseClient,
  actor: SecureDeviceActor,
  siteId: string | null,
  action: SecureDeviceAction,
  deviceIdentifier: string,
  payload: Record<string, unknown> = {},
  channel = "web",
): Promise<{ device: SecureDeviceRow; command_id: string | null; command_type: string; queued: boolean; command: Record<string, any> | null }> {
  assertCanManageSecureDevices(actor);
  const commandType = COMMAND_TYPES[action];
  if (!commandType) throw new Error("Unsupported secure device action");

  const device = await getSecureDeviceByIdentifier(client, actor, siteId, deviceIdentifier);
  if (!device) throw new Error("Device not found for active site");

  const now = new Date().toISOString();
  const { data: existing } = await client
    .from("device_commands")
    .select("id, command_type, status, issued_at")
    .eq("company_id", actor.company_id)
    .eq("device_id", device.id)
    .eq("command_type", commandType)
    .in("status", ["pending", "sent"])
    .gte("issued_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(1);

  let command = existing?.[0] ?? null;
  const duplicateQueued = Boolean(command);
  if (!command) {
    const { data, error } = await client
      .from("device_commands")
      .insert({
        company_id: actor.company_id,
        device_id: device.id,
        command_type: commandType,
        status: "pending",
        payload: { ...payload, channel, source: channel, requested_action: action, secure_action: action },
        issued_by: actor.user_id ?? null,
      })
      .select("id, command_type, status, issued_at")
      .maybeSingle();
    if (error) throw error;
    command = data ?? null;
  }

  const statusPatch: Record<string, unknown> = {};
  if (action === "request_device_disable") statusPatch.secure_mode_status = "disabled";
  if (action === "request_device_enable") statusPatch.secure_mode_status = "active";
  if (action === "revoke_device") {
    statusPatch.secure_mode_status = "revoked";
    statusPatch.pairing_status = "revoked";
    statusPatch.revoked_at = now;
    statusPatch.revoked_by = actor.user_id ?? null;
  }
  if (action === "request_maintenance_mode") {
    statusPatch.secure_mode_status = "maintenance";
    statusPatch.maintenance_expires_at = payload.expires_at ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();
  }
  if (action === "request_exit_maintenance") {
    statusPatch.secure_mode_status = "active";
    statusPatch.maintenance_expires_at = null;
  }
  if (action === "request_app_update") statusPatch.secure_mode_status = "update_required";
  if (Object.keys(statusPatch).length) {
    await client.from("devices").update(statusPatch).eq("id", device.id).eq("company_id", actor.company_id);
  }

  await client.from("device_security_events").insert({
    company_id: actor.company_id,
    site_id: device.site_id ?? siteId,
    device_id: device.id,
    device_identifier: device.device_identifier,
    event_type: action,
    severity: action === "revoke_device" || action === "request_device_disable" ? "critical" : "info",
    initiated_by: actor.user_id ?? null,
    metadata: { command_id: command?.id ?? null, channel, duplicate_queued: duplicateQueued, payload },
  });

  return { device, command_id: command?.id ?? null, command_type: commandType, queued: device.status !== "online" || duplicateQueued, command };
}

export async function getSecureDeviceEvents(
  client: SupabaseClient,
  actor: SecureDeviceActor,
  siteId: string | null,
  deviceId?: string | null,
): Promise<Array<Record<string, any>>> {
  assertCanManageSecureDevices(actor);
  let query = client
    .from("device_security_events")
    .select("id, event_type, severity, occurred_at, device_identifier, device_id, site_id, metadata")
    .eq("company_id", actor.company_id)
    .order("occurred_at", { ascending: false })
    .limit(10);
  if (siteId) query = query.eq("site_id", siteId);
  if (deviceId) query = query.eq("device_id", deviceId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export function formatSecureDeviceLabel(row: SecureDeviceRow): string {
  const device = normalizeDevice(row);
  const name = device.device_name ? " - " + device.device_name : "";
  return String(device.device_identifier ?? "Device") + name;
}

export function formatDeviceSecurityLine(row: SecureDeviceRow, index?: number): string {
  const device = normalizeDevice(row);
  const prefix = index != null ? String(index + 1) + ". " : "";
  return prefix + formatSecureDeviceLabel(device)
    + "\nStatus: " + String(device.status ?? "unknown")
    + " | Site: " + String(device.site ?? "Unassigned")
    + " | Kiosk: " + (device.kiosk_active ? "Locked" : "Inactive")
    + " | Security: " + deviceSecurityState(device)
    + "\nApp: " + String(device.app_version ?? "unknown")
    + " | Last seen: " + timeAgo(device.last_seen_at);
}