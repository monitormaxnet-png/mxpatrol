// Canonical management write service.
// Used by BOTH assistants:
//  - Web Management AI  -> supabase/functions/management-actions (edge function)
//  - WhatsApp Management AI -> supabase/functions/whatsapp-webhook/lib/flows.ts
// Never duplicate this business logic anywhere else.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type ManagementActor = {
  company_id: string;
  user_id?: string | null;
  guard_id?: string | null;
  role?: string | null;
  canManage?: boolean;
  allowed_site_ids?: string[];
};

export type ManagementActionName =
  | "create_incident"
  | "register_device"
  | "attach_device_by_code"
  | "create_checkpoint"
  | "create_patrol_template"
  | "create_route"
  | "create_schedule";

export type ManagementResult = {
  ok: true;
  action: ManagementActionName;
  duplicate: boolean;
  record: Record<string, unknown>;
  summary: string;
};

export class ManagementActionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ManagementActionError";
    this.status = status;
  }
}

const SEVERITIES = ["low", "medium", "high", "critical"];
const FREQUENCIES = ["once", "hourly", "daily", "weekdays", "weekends", "weekly", "custom", "every_n_minutes", "every_n_hours"];
const DEVICE_TYPES = ["mobile", "pda", "nfc_reader", "tablet"];
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/* --------------------------------- guards --------------------------------- */

export function assertCanManage(actor: ManagementActor | null | undefined) {
  if (!actor?.company_id) throw new ManagementActionError("Authenticated company context required", 401);
  const role = String(actor.role ?? "");
  if (!actor.canManage && role !== "admin" && role !== "supervisor") {
    throw new ManagementActionError("Management access required", 403);
  }
}

export function text(value: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const min = opts.min ?? 1;
  if (!raw) {
    if (opts.required === false) return "";
    throw new ManagementActionError(`${field} is required`);
  }
  if (raw.length < min) throw new ManagementActionError(`${field} must be at least ${min} characters`);
  return raw.slice(0, opts.max ?? 120);
}

export function normalizeNfcTag(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-f0-9]/g, "");
}

export function normalizeTime(value: unknown, field = "Start time"): string {
  const match = String(value ?? "").trim().match(/^(\d{1,2})[:h.]?(\d{2})?$/);
  if (!match) throw new ManagementActionError(`${field} must look like 22:00`);
  const hours = Math.min(Number(match[1]), 23).toString().padStart(2, "0");
  const minutes = Math.min(Number(match[2] ?? "0"), 59).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function generatePairingCode(): string {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += PAIRING_CODE_ALPHABET[Math.floor(Math.random() * PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

export function nextRunFromTime(startTime: string, now = new Date()): string {
  const [hours, minutes] = startTime.split(":").map(Number);
  const next = new Date(now.getTime());
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

/** Every write must resolve the active site inside the actor's company. */
export async function resolveSite(client: SupabaseClient, actor: ManagementActor, siteId: unknown): Promise<{ id: string; name: string }> {
  const id = typeof siteId === "string" ? siteId.trim() : "";
  if (!id) throw new ManagementActionError("An active site is required before creating records");
  if (actor.allowed_site_ids?.length && !actor.allowed_site_ids.includes(id)) {
    throw new ManagementActionError("You do not have access to that site", 403);
  }
  const { data, error } = await client
    .from("sites")
    .select("id, name")
    .eq("company_id", actor.company_id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("Active site not found for your company", 404);
  return { id: data.id, name: data.name };
}

function recent(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < DEDUPE_WINDOW_MS;
}

/* ------------------------------- incidents -------------------------------- */

export async function createIncident(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const description = text(input.description, "Incident description", { min: 3, max: 1000 });
  const severity = String(input.severity ?? "low").toLowerCase();
  if (!SEVERITIES.includes(severity)) throw new ManagementActionError("Severity must be low, medium, high or critical");
  const title = text(input.title ?? description, "Incident title", { max: 80 });

  const { data: existing } = await client
    .from("incidents")
    .select("id, title, severity, resolved, created_at, site_id")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("title", title)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && recent(existing.created_at)) {
    return incidentResult(existing, site, true);
  }

  const { data, error } = await client
    .from("incidents")
    .insert({
      company_id: actor.company_id,
      site_id: site.id,
      guard_id: actor.guard_id ?? null,
      title,
      description,
      severity,
      image_url: typeof input.image_url === "string" ? input.image_url : null,
      ai_classification: String(input.source ?? "assistant_report"),
      ai_suggested_action: "Review and dispatch supervisor",
      event_occurred_at: new Date().toISOString(),
    })
    .select("id, title, severity, resolved, created_at, site_id")
    .maybeSingle();

  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("Incident could not be saved", 500);
  return incidentResult(data, site, false);
}

function incidentResult(row: Record<string, any>, site: { id: string; name: string }, duplicate: boolean): ManagementResult {
  const reference = `INC-${String(row.id).slice(0, 8).toUpperCase()}`;
  return {
    ok: true,
    action: "create_incident",
    duplicate,
    record: { id: row.id, reference, title: row.title, severity: row.severity, status: row.resolved ? "resolved" : "open", site_id: site.id, site_name: site.name },
    summary: `${reference} logged at ${site.name} (${row.severity}, ${row.resolved ? "resolved" : "open"})`,
  };
}

/* --------------------------------- devices -------------------------------- */

export async function registerDevice(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const deviceName = text(input.device_name, "Device name", { max: 100 });
  const deviceType = String(input.device_type ?? "mobile");
  if (!DEVICE_TYPES.includes(deviceType)) throw new ManagementActionError("Device type must be mobile, pda, nfc_reader or tablet");

  const { data: existing } = await client
    .from("devices")
    .select("id, device_name, device_identifier, pairing_code, pairing_status, pairing_expires_at, site_id, created_at")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("device_name", deviceName)
    .eq("pairing_status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && recent(existing.created_at)) {
    return deviceResult(existing, site, true);
  }

  const pairingCode = generatePairingCode();
  const { data, error } = await client
    .from("devices")
    .insert({
      company_id: actor.company_id,
      site_id: site.id,
      device_name: deviceName,
      device_type: deviceType,
      device_identifier: `pending-${crypto.randomUUID()}`,
      serial_number: typeof input.serial_number === "string" && input.serial_number ? input.serial_number : null,
      notes: typeof input.notes === "string" && input.notes ? input.notes : null,
      site_location: site.name,
      pairing_code: pairingCode,
      pairing_status: "pending",
      pairing_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      enrolled_via: String(input.enrolled_via ?? "assistant"),
    })
    .select("id, device_name, device_identifier, pairing_code, pairing_status, pairing_expires_at, site_id")
    .maybeSingle();

  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("Device could not be registered", 500);
  return deviceResult(data, site, false);
}

function deviceResult(row: Record<string, any>, site: { id: string; name: string }, duplicate: boolean): ManagementResult {
  return {
    ok: true,
    action: "register_device",
    duplicate,
    record: {
      id: row.id,
      device_name: row.device_name,
      pairing_code: row.pairing_code,
      pairing_status: row.pairing_status,
      pairing_expires_at: row.pairing_expires_at,
      site_id: site.id,
      site_name: site.name,
    },
    summary: `${row.device_name} is pending pairing at ${site.name}. Enter code ${row.pairing_code} in MX Patrol on the device.`,
  };
}

/** Completes enrollment when the device already shows a pairing code (canonical device-pair path). */
export async function attachDeviceByCode(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const code = String(input.pairing_code ?? "").trim().toUpperCase().replace(/^MXP?-?/, "").replace(/[\s-]/g, "");
  if (code.length !== 8) throw new ManagementActionError("Pairing codes are 8 characters, e.g. MXP-7K3P92AB");
  const deviceName = text(input.device_name, "Device name", { max: 100 });

  const { data: device, error } = await client
    .from("devices")
    .select("id, device_identifier, device_name, pairing_status, pairing_expires_at, site_id")
    .eq("company_id", actor.company_id)
    .eq("pairing_code", code)
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!device) throw new ManagementActionError(`No device is waiting with code ${code}`, 404);
  if (device.pairing_status === "paired") {
    return {
      ok: true,
      action: "attach_device_by_code",
      duplicate: true,
      record: { id: device.id, device_name: device.device_name, pairing_status: "paired", site_id: device.site_id },
      summary: `${device.device_name ?? device.device_identifier} is already registered.`,
    };
  }

  const { data: updated, error: updateError } = await client
    .from("devices")
    .update({
      device_name: deviceName,
      site_id: site.id,
      site_location: site.name,
      pairing_status: "paired",
      pairing_code: null,
      pairing_expires_at: null,
    })
    .eq("id", device.id)
    .eq("company_id", actor.company_id)
    .select("id, device_name, device_identifier, pairing_status, site_id")
    .maybeSingle();
  if (updateError) throw new ManagementActionError(updateError.message, 500);

  return {
    ok: true,
    action: "attach_device_by_code",
    duplicate: false,
    record: { ...(updated ?? {}), site_name: site.name },
    summary: `${deviceName} is now registered to ${site.name}.`,
  };
}

/* ------------------------------- checkpoints ------------------------------ */

export type PendingFormInput = {
  name: string;
  form_type: string;
  fields: Array<{ label: string; field_type: string; required?: boolean; sequence_order?: number }>;
};

async function createDataLogForm(client: SupabaseClient, actor: ManagementActor, siteId: string, pending: PendingFormInput) {
  const { data: form, error } = await client
    .from("data_log_forms")
    .insert({
      company_id: actor.company_id,
      site_id: siteId,
      name: text(pending.name, "Form name", { max: 120 }),
      description: "Created by the MX Patrol Management AI during checkpoint registration",
      form_type: pending.form_type,
      created_by: actor.user_id ?? null,
      is_active: true,
    })
    .select("id, name, form_type")
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!form?.id) throw new ManagementActionError("Data Log Form was not created", 500);

  const rows = (pending.fields ?? []).map((field, index) => ({
    form_id: form.id,
    company_id: actor.company_id,
    label: field.label,
    field_type: field.field_type,
    required: field.required ?? false,
    sequence_order: field.sequence_order ?? index + 1,
    options_json: [],
    config_json: {},
    is_active: true,
  }));
  if (rows.length) {
    const { error: fieldError } = await client.from("data_log_form_fields").insert(rows);
    if (fieldError) {
      await client.from("data_log_forms").delete().eq("id", form.id);
      throw new ManagementActionError(fieldError.message, 500);
    }
  }
  return { id: form.id as string, name: form.name as string, field_count: rows.length };
}

export async function createCheckpoint(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const name = text(input.name, "Checkpoint name", { max: 80 });
  const locationNote = text(input.location_note, "Zone / location", { required: false, max: 120 });
  const nfcTagId = normalizeNfcTag(input.nfc_tag_id);

  const { data: existing } = await client
    .from("checkpoints")
    .select("id, name, nfc_tag_id, data_log_form_id, site_id, created_at")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("name", name)
    .maybeSingle();
  if (existing) return checkpointResult(existing, site, null, true);

  if (nfcTagId) {
    const { data: clash } = await client
      .from("checkpoints")
      .select("id, name")
      .eq("company_id", actor.company_id)
      .eq("nfc_tag_id", nfcTagId)
      .maybeSingle();
    if (clash) throw new ManagementActionError(`That NFC tag is already assigned to ${clash.name}`, 409);
  }

  let form: { id: string; name: string; field_count: number } | null = null;
  let formId = typeof input.data_log_form_id === "string" && input.data_log_form_id ? input.data_log_form_id : null;
  if (input.new_form) {
    form = await createDataLogForm(client, actor, site.id, input.new_form as PendingFormInput);
    formId = form.id;
  } else if (formId) {
    const { data: existingForm } = await client
      .from("data_log_forms")
      .select("id, name")
      .eq("company_id", actor.company_id)
      .eq("id", formId)
      .maybeSingle();
    if (!existingForm) throw new ManagementActionError("Selected Data Log Form was not found", 404);
    form = { id: existingForm.id, name: existingForm.name, field_count: 0 };
  }

  const { data, error } = await client
    .from("checkpoints")
    .insert({
      company_id: actor.company_id,
      site_id: site.id,
      name,
      location_note: locationNote || null,
      nfc_tag_id: nfcTagId,
      data_log_form_id: formId,
      location_lat: typeof input.location_lat === "number" ? input.location_lat : null,
      location_lng: typeof input.location_lng === "number" ? input.location_lng : null,
      sort_order: 0,
    })
    .select("id, name, nfc_tag_id, data_log_form_id, site_id")
    .maybeSingle();

  if (error) {
    if (form && input.new_form) await client.from("data_log_forms").delete().eq("id", form.id);
    throw new ManagementActionError(error.message, 500);
  }
  if (!data) throw new ManagementActionError("Checkpoint could not be created", 500);
  return checkpointResult(data, site, form, false);
}

function checkpointResult(
  row: Record<string, any>,
  site: { id: string; name: string },
  form: { id: string; name: string } | null,
  duplicate: boolean,
): ManagementResult {
  const nfcStatus = row.nfc_tag_id ? "assigned" : "pending_assignment";
  return {
    ok: true,
    action: "create_checkpoint",
    duplicate,
    record: {
      id: row.id,
      name: row.name,
      nfc_tag_id: row.nfc_tag_id || null,
      nfc_status: nfcStatus,
      data_log_form_id: row.data_log_form_id ?? null,
      data_log_form_name: form?.name ?? null,
      site_id: site.id,
      site_name: site.name,
    },
    summary: `${row.name} saved at ${site.name} (NFC ${nfcStatus === "assigned" ? "assigned" : "awaiting assignment"}${form ? `, form: ${form.name}` : ""})`,
  };
}

/* ---------------------------- patrol configuration ------------------------ */

export async function createPatrolTemplate(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const name = text(input.name, "Patrol name", { max: 80 });

  const { data: existing } = await client
    .from("patrol_templates")
    .select("id, name, site_id, expected_duration_minutes")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      action: "create_patrol_template",
      duplicate: true,
      record: { ...existing, site_name: site.name },
      summary: `${name} already exists at ${site.name}.`,
    };
  }

  const duration = Number(input.expected_duration_minutes ?? 60);
  const { data, error } = await client
    .from("patrol_templates")
    .insert({
      company_id: actor.company_id,
      site_id: site.id,
      name,
      description: text(input.description, "Description", { required: false, max: 500 }) || null,
      status: "active",
      expected_duration_minutes: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 24 * 60) : 60,
      created_by: actor.user_id ?? null,
    })
    .select("id, name, site_id, expected_duration_minutes")
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("Patrol template could not be created", 500);
  return {
    ok: true,
    action: "create_patrol_template",
    duplicate: false,
    record: { ...data, site_name: site.name },
    summary: `Patrol template ${name} created at ${site.name}.`,
  };
}

export async function createRoute(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const name = text(input.name, "Route name", { max: 80 });
  const checkpointIds = Array.isArray(input.checkpoint_ids) ? (input.checkpoint_ids as string[]).filter((id) => typeof id === "string" && id) : [];
  if (!checkpointIds.length) throw new ManagementActionError("Select at least one checkpoint for the route");

  const { data: checkpoints, error: checkpointError } = await client
    .from("checkpoints")
    .select("id, name")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .in("id", checkpointIds);
  if (checkpointError) throw new ManagementActionError(checkpointError.message, 500);
  const found = new Set((checkpoints ?? []).map((row: Record<string, any>) => row.id));
  if (checkpointIds.some((id) => !found.has(id))) {
    throw new ManagementActionError("One or more checkpoints do not belong to the active site", 403);
  }

  const { data: existing } = await client
    .from("patrol_routes")
    .select("id, name, site_id, created_at")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      action: "create_route",
      duplicate: true,
      record: { ...existing, site_name: site.name, checkpoint_count: checkpointIds.length },
      summary: `Route ${name} already exists at ${site.name}.`,
    };
  }

  const { data: route, error } = await client
    .from("patrol_routes")
    .insert({
      company_id: actor.company_id,
      site_id: site.id,
      template_id: typeof input.template_id === "string" && input.template_id ? input.template_id : null,
      name,
      description: text(input.description, "Description", { required: false, max: 500 }) || "Created by the MX Patrol Management AI",
      status: "active",
      enforce_sequence: Boolean(input.enforce_sequence),
      created_by: actor.user_id ?? null,
    })
    .select("id, name, site_id, enforce_sequence")
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!route?.id) throw new ManagementActionError("Route could not be created", 500);

  // Canonical checkpoint ordering column is sequence_order.
  const rows = checkpointIds.map((checkpointId, index) => ({
    company_id: actor.company_id,
    route_id: route.id,
    checkpoint_id: checkpointId,
    sequence_order: index + 1,
    expected_offset_minutes: index * 5,
    expected_arrival_offset_minutes: index * 5,
    is_required: true,
  }));
  const { error: linkError } = await client.from("patrol_route_checkpoints").insert(rows);
  if (linkError) {
    await client.from("patrol_routes").delete().eq("id", route.id);
    throw new ManagementActionError(linkError.message, 500);
  }

  return {
    ok: true,
    action: "create_route",
    duplicate: false,
    record: { ...route, site_name: site.name, checkpoint_count: rows.length },
    summary: `Route ${name} created at ${site.name} with ${rows.length} ordered checkpoints.`,
  };
}

export async function createSchedule(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const routeId = typeof input.route_id === "string" ? input.route_id.trim() : "";
  if (!routeId) throw new ManagementActionError("A patrol route is required for a schedule");

  const { data: route, error: routeError } = await client
    .from("patrol_routes")
    .select("id, name, template_id, site_id")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("id", routeId)
    .maybeSingle();
  if (routeError) throw new ManagementActionError(routeError.message, 500);
  if (!route) throw new ManagementActionError("That route does not belong to the active site", 403);

  const frequency = String(input.frequency ?? "daily").toLowerCase();
  if (!FREQUENCIES.includes(frequency)) throw new ManagementActionError("Unsupported patrol frequency");
  const startTime = normalizeTime(input.start_time);
  const endTime = input.end_time ? normalizeTime(input.end_time, "End time") : null;
  const name = text(input.name ?? `${route.name} Schedule`, "Schedule name", { max: 80 });
  const days = Array.isArray(input.days_of_week) && (input.days_of_week as number[]).length
    ? (input.days_of_week as number[]).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [0, 1, 2, 3, 4, 5, 6];

  const { data: existing } = await client
    .from("patrol_schedules")
    .select("id, name, route_id, start_time, status, site_id")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("route_id", route.id)
    .eq("start_time", startTime)
    .eq("status", "active")
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      action: "create_schedule",
      duplicate: true,
      record: { ...existing, site_name: site.name, route_name: route.name },
      summary: `An active schedule for ${route.name} at ${startTime} already exists.`,
    };
  }

  const { data, error } = await client
    .from("patrol_schedules")
    .insert({
      company_id: actor.company_id,
      site_id: site.id,
      route_id: route.id,
      template_id: route.template_id ?? null,
      name,
      frequency,
      frequency_type: frequency,
      interval_value: Math.max(Number(input.interval_value ?? 1) || 1, 1),
      start_time: startTime,
      end_time: endTime,
      days_of_week: days,
      timezone: String(input.timezone ?? "Africa/Johannesburg"),
      status: "active",
      active_from: new Date().toISOString(),
      next_run_at: nextRunFromTime(startTime),
      grace_start_minutes: 10,
      grace_completion_minutes: 30,
      expected_duration_minutes: Math.max(Number(input.expected_duration_minutes ?? 40) || 40, 10),
      description: "Created by the MX Patrol Management AI",
      created_by: actor.user_id ?? null,
    })
    .select("id, name, route_id, start_time, end_time, frequency_type, next_run_at, days_of_week, site_id")
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("Schedule could not be created", 500);

  return {
    ok: true,
    action: "create_schedule",
    duplicate: false,
    record: { ...data, site_name: site.name, route_name: route.name },
    summary: `${name} scheduled (${frequency} at ${startTime}) for ${route.name} at ${site.name}. Sessions generate automatically.`,
  };
}

/* -------------------------------- dispatcher ------------------------------ */

export async function runManagementAction(
  client: SupabaseClient,
  actor: ManagementActor,
  action: string,
  input: Record<string, unknown>,
): Promise<ManagementResult> {
  switch (action) {
    case "create_incident":
      return await createIncident(client, actor, input);
    case "register_device":
      return await registerDevice(client, actor, input);
    case "attach_device_by_code":
      return await attachDeviceByCode(client, actor, input);
    case "create_checkpoint":
      return await createCheckpoint(client, actor, input);
    case "create_patrol_template":
      return await createPatrolTemplate(client, actor, input);
    case "create_route":
      return await createRoute(client, actor, input);
    case "create_schedule":
      return await createSchedule(client, actor, input);
    default:
      throw new ManagementActionError(`Unsupported management action: ${action}`, 400);
  }
}
