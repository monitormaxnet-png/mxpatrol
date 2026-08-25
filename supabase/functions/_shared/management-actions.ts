// Canonical management write service.
// Used by BOTH assistants:
//  - Web Management AI  -> supabase/functions/management-actions (edge function)
//  - WhatsApp Management AI -> supabase/functions/whatsapp-webhook/lib/flows.ts
// Never duplicate this business logic anywhere else.

import { normalizeFormFields, normalizeFormType, type NormalizedFormField } from "./data-log-fields.ts";

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
  | "create_schedule"
  | "create_whatsapp_authorization"
  | "list_whatsapp_authorizations"
  | "revoke_whatsapp_authorization";

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
const WHATSAPP_LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WHATSAPP_LINK_TTL_MS = 24 * 60 * 60 * 1000;
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

export function normalizePairingCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/^MXP?[-\s]?/, "").replace(/[\s-]/g, "");
}

/**
 * CANONICAL device registration.
 *
 * Management NEVER generates a pairing code. The unpaired physical MX Patrol device
 * displays its own code (e.g. MX-48768); management binds that physical device to a
 * device record using the code shown on its screen.
 */
export async function registerDevice(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const deviceName = text(input.device_name, "Device name", { max: 100 });
  const deviceType = String(input.device_type ?? "mobile");
  if (!DEVICE_TYPES.includes(deviceType)) throw new ManagementActionError("Device type must be mobile, pda, nfc_reader or tablet");

  const code = normalizePairingCode(input.pairing_code);
  if (code.length < 5 || code.length > 10) {
    throw new ManagementActionError("Enter the pairing code shown on the MX Patrol device, e.g. MX-48768");
  }

  // Path A — a device record in this company already carries this code (admin-issued code).
  const { data: existingDevice, error: existingError } = await client
    .from("devices")
    .select("id, device_identifier, device_name, pairing_status, pairing_expires_at, site_id")
    .eq("company_id", actor.company_id)
    .eq("pairing_code", code)
    .maybeSingle();
  if (existingError) throw new ManagementActionError(existingError.message, 500);

  if (existingDevice) {
    if (existingDevice.pairing_status === "paired" || existingDevice.pairing_status === "active") {
      return {
        ok: true,
        action: "register_device",
        duplicate: true,
        record: { id: existingDevice.id, device_name: existingDevice.device_name, pairing_status: "paired", site_id: existingDevice.site_id },
        summary: `${existingDevice.device_name ?? existingDevice.device_identifier} is already registered. Pairing code ${code} has already been used.`,
      };
    }
    if (existingDevice.pairing_expires_at && new Date(existingDevice.pairing_expires_at) < new Date()) {
      throw new ManagementActionError(`Pairing code ${code} has expired. Reopen MX Patrol on the device to get a fresh code.`, 410);
    }
    const { data: updated, error: updateError } = await client
      .from("devices")
      .update({
        device_name: deviceName,
        device_type: deviceType,
        site_id: site.id,
        site_location: site.name,
        pairing_status: "paired",
        pairing_code: null,
        pairing_expires_at: null,
        enrolled_via: String(input.enrolled_via ?? "assistant_pairing_code"),
      })
      .eq("id", existingDevice.id)
      .eq("company_id", actor.company_id)
      .select("id, device_name, device_identifier, device_type, pairing_status, site_id")
      .maybeSingle();
    if (updateError) throw new ManagementActionError(updateError.message, 500);
    return devicePairedResult(updated ?? existingDevice, site, deviceName, code);
  }

  // Path B — the physical device published the code itself (device-initiated pairing request).
  const { data: request, error: requestError } = await client
    .from("device_pairing_requests")
    .select("id, pairing_code, device_identifier, device_metadata, status, expires_at, claimed_device_id")
    .eq("pairing_code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw new ManagementActionError(requestError.message, 500);

  if (!request) {
    throw new ManagementActionError(`No MX Patrol device is currently showing code ${code}. Check the code on the device screen and try again.`, 404);
  }
  if (request.status === "claimed") {
    throw new ManagementActionError(`Pairing code ${code} has already been used to register a device.`, 409);
  }
  if (request.status !== "pending" || new Date(request.expires_at) < new Date()) {
    await client.from("device_pairing_requests").update({ status: "expired" }).eq("id", request.id);
    throw new ManagementActionError(`Pairing code ${code} has expired. Reopen MX Patrol on the device to get a fresh code.`, 410);
  }

  const metadata = (request.device_metadata ?? {}) as Record<string, unknown>;
  const { data: conflicting, error: conflictError } = await client
    .from("devices")
    .select("id, company_id, device_name, pairing_status")
    .eq("device_identifier", request.device_identifier)
    .maybeSingle();
  if (conflictError) throw new ManagementActionError(conflictError.message, 500);
  if (conflicting && conflicting.company_id !== actor.company_id) {
    throw new ManagementActionError("This physical device is already registered to another organisation.", 409);
  }

  const deviceFields = {
    device_name: deviceName,
    device_type: deviceType,
    site_id: site.id,
    site_location: site.name,
    pairing_status: "paired",
    pairing_code: null,
    pairing_expires_at: null,
    status: "online" as const,
    enrolled_via: String(input.enrolled_via ?? "assistant_pairing_code"),
    serial_number: typeof metadata.serial_number === "string" ? metadata.serial_number : null,
  };

  let deviceRow: Record<string, any> | null = null;
  if (conflicting) {
    const { data, error } = await client
      .from("devices")
      .update(deviceFields)
      .eq("id", conflicting.id)
      .eq("company_id", actor.company_id)
      .select("id, device_name, device_identifier, device_type, pairing_status, site_id")
      .maybeSingle();
    if (error) throw new ManagementActionError(error.message, 500);
    deviceRow = data;
  } else {
    const { data, error } = await client
      .from("devices")
      .insert({
        company_id: actor.company_id,
        device_identifier: request.device_identifier,
        ...deviceFields,
      })
      .select("id, device_name, device_identifier, device_type, pairing_status, site_id")
      .maybeSingle();
    if (error) throw new ManagementActionError(error.message, 500);
    deviceRow = data;
  }

  if (!deviceRow) throw new ManagementActionError("Device could not be registered", 500);

  const { error: claimError } = await client
    .from("device_pairing_requests")
    .update({
      status: "claimed",
      claimed_at: new Date().toISOString(),
      claimed_device_id: deviceRow.id,
      claimed_company_id: actor.company_id,
    })
    .eq("id", request.id)
    .eq("status", "pending");
  if (claimError) throw new ManagementActionError(claimError.message, 500);

  return devicePairedResult(deviceRow, site, deviceName, code);
}

function devicePairedResult(row: Record<string, any>, site: { id: string; name: string }, deviceName: string, code: string): ManagementResult {
  return {
    ok: true,
    action: "register_device",
    duplicate: false,
    record: {
      id: row.id,
      device_name: row.device_name ?? deviceName,
      device_identifier: row.device_identifier,
      device_type: row.device_type,
      pairing_status: "paired",
      pairing_code_used: code,
      site_id: site.id,
      site_name: site.name,
    },
    summary: `${deviceName} is now bound to the physical device (code ${code}) and registered to ${site.name}.`,
  };
}

/** Back-compat alias: both assistants and older callers hit the same canonical binding path. */
export async function attachDeviceByCode(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  return await registerDevice(client, actor, input);
}


/* ------------------------------- checkpoints ------------------------------ */

export type PendingFormInput = {
  name: string;
  form_type?: string;
  fields: unknown;
};

/**
 * Creates a Data Log Form + its fields. If field insertion fails the form is
 * removed again so no orphan form can survive a failed checkpoint registration.
 */
async function createDataLogForm(client: SupabaseClient, actor: ManagementActor, siteId: string, pending: PendingFormInput) {
  let fields: NormalizedFormField[];
  try {
    fields = normalizeFormFields(pending?.fields);
  } catch (error) {
    throw new ManagementActionError(error instanceof Error ? error.message : "Invalid Data Log Form fields", 400);
  }
  const formName = text(pending?.name, "Form name", { min: 2, max: 120 });
  const formType = normalizeFormType(pending?.form_type, fields);

  const { data: form, error } = await client
    .from("data_log_forms")
    .insert({
      company_id: actor.company_id,
      site_id: siteId,
      name: formName,
      description: "Created by the MX Patrol Management AI during checkpoint registration",
      form_type: formType,
      created_by: actor.user_id ?? null,
      is_active: true,
    })
    .select("id, name, form_type")
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!form?.id) throw new ManagementActionError("Data Log Form was not created", 500);

  const rows = fields.map((field) => ({
    form_id: form.id,
    company_id: actor.company_id,
    label: field.label,
    field_type: field.field_type,
    required: field.required,
    sequence_order: field.sequence_order,
    placeholder: field.placeholder,
    options_json: field.options_json,
    config_json: {},
    is_active: true,
  }));

  const { error: fieldError } = await client.from("data_log_form_fields").insert(rows);
  if (fieldError) {
    await client.from("data_log_form_fields").delete().eq("form_id", form.id);
    await client.from("data_log_forms").delete().eq("id", form.id).eq("company_id", actor.company_id);
    throw new ManagementActionError(fieldError.message, 500);
  }
  return { id: form.id as string, name: form.name as string, form_type: formType, field_count: rows.length };
}

async function rollbackForm(client: SupabaseClient, actor: ManagementActor, formId: string) {
  await client.from("data_log_form_fields").delete().eq("form_id", formId);
  await client.from("data_log_forms").delete().eq("id", formId).eq("company_id", actor.company_id);
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
  let createdFormId: string | null = null;
  let formId = typeof input.data_log_form_id === "string" && input.data_log_form_id ? input.data_log_form_id : null;

  if (input.new_form) {
    if (formId) throw new ManagementActionError("Choose either an existing Data Log Form or a new one, not both");
    form = await createDataLogForm(client, actor, site.id, input.new_form as PendingFormInput);
    createdFormId = form.id;
    formId = form.id;
  } else if (formId) {
    // Tenant + site scope: company must match and the form must be global or
    // belong to the active site. Never allow attaching another tenant's form.
    const { data: existingForm, error: formError } = await client
      .from("data_log_forms")
      .select("id, name, site_id, is_active, data_log_form_fields(id)")
      .eq("company_id", actor.company_id)
      .eq("id", formId)
      .maybeSingle();
    if (formError) throw new ManagementActionError(formError.message, 500);
    if (!existingForm || existingForm.is_active === false) {
      throw new ManagementActionError("Selected Data Log Form was not found", 404);
    }
    if (existingForm.site_id && existingForm.site_id !== site.id) {
      throw new ManagementActionError("That Data Log Form belongs to another site", 403);
    }
    const fieldCount = Array.isArray(existingForm.data_log_form_fields) ? existingForm.data_log_form_fields.length : 0;
    if (!fieldCount) throw new ManagementActionError("That Data Log Form has no fields yet, so it cannot be attached", 400);
    form = { id: existingForm.id, name: existingForm.name, field_count: fieldCount };
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

  if (error || !data) {
    if (createdFormId) await rollbackForm(client, actor, createdFormId);
    throw new ManagementActionError(error?.message ?? "Checkpoint could not be created", 500);
  }

  // The checkpoint must never be reported as created without its form relation.
  if (formId && data.data_log_form_id !== formId) {
    await client.from("checkpoints").delete().eq("id", data.id).eq("company_id", actor.company_id);
    if (createdFormId) await rollbackForm(client, actor, createdFormId);
    throw new ManagementActionError("Data Log Form could not be attached to the checkpoint", 500);
  }

  return checkpointResult(data, site, form, false);
}


function checkpointResult(
  row: Record<string, any>,
  site: { id: string; name: string },
  form: { id: string; name: string; field_count?: number } | null,
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
      data_log_field_count: form?.field_count ?? null,
      site_id: site.id,
      site_name: site.name,
    },
    summary: `${row.name} saved at ${site.name} (NFC ${nfcStatus === "assigned" ? "assigned" : "awaiting assignment"}${form ? `, form: ${form.name}` : ""})`,
  };
}

/* ---------------------------- patrol configuration ------------------------ */

export type PatrolTemplateOperationalRules = {
  checkpoints_required: boolean;
  sequential_scanning: boolean;
  expected_duration_enforced: boolean;
  missed_checkpoints_recorded: boolean;
  late_start_tracking: boolean;
  incomplete_patrol_tracking: boolean;
  offline_scans_allowed: boolean;
};

export function normalizePatrolTemplateRules(input: unknown): PatrolTemplateOperationalRules {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    checkpoints_required: true,
    sequential_scanning: Boolean(source.sequential_scanning),
    expected_duration_enforced: true,
    missed_checkpoints_recorded: true,
    late_start_tracking: true,
    incomplete_patrol_tracking: true,
    offline_scans_allowed: source.offline_scans_allowed === undefined ? true : Boolean(source.offline_scans_allowed),
  };
}

export async function createPatrolTemplate(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const name = text(input.name, "Patrol name", { max: 80 });

  const { data: existing } = await client
    .from("patrol_templates")
    .select("id, name, site_id, description, expected_duration_minutes, operational_rules")
    .eq("company_id", actor.company_id)
    .eq("site_id", site.id)
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      action: "create_patrol_template",
      duplicate: true,
      record: { ...existing, site_name: site.name, route_status: "not_assigned" },
      summary: `${name} already exists at ${site.name}. Route not assigned yet.`,
    };
  }

  const duration = Number(input.expected_duration_minutes ?? 60);
  const rules = normalizePatrolTemplateRules(input.operational_rules);
  const { data, error } = await client
    .from("patrol_templates")
    .insert({
      company_id: actor.company_id,
      site_id: site.id,
      name,
      description: text(input.description, "Description", { required: false, max: 500 }) || null,
      status: "active",
      expected_duration_minutes: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 24 * 60) : 60,
      operational_rules: rules,
      created_by: actor.user_id ?? null,
    })
    .select("id, name, site_id, description, expected_duration_minutes, operational_rules")
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("Patrol template could not be created", 500);
  return {
    ok: true,
    action: "create_patrol_template",
    duplicate: false,
    record: { ...data, site_name: site.name, route_status: "not_assigned" },
    summary: `Patrol template ${name} created at ${site.name}. Route not assigned yet.`,
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


/* -------------------------- WhatsApp authorization ------------------------- */

export function normalizeWhatsAppPhone(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/^whatsapp:/i, "");
  const compact = raw.replace(/[^+0-9]/g, "");
  if (!compact) return "";
  return compact.startsWith("+") ? compact : "+" + compact;
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "Not linked";
  const visible = phone.slice(-3);
  return phone.slice(0, Math.min(4, phone.length)) + "***" + visible;
}

function generateWhatsAppLinkCode(): string {
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix += WHATSAPP_LINK_CODE_ALPHABET[Math.floor(Math.random() * WHATSAPP_LINK_CODE_ALPHABET.length)];
  }
  return "MX-WA-" + suffix;
}

async function uniqueWhatsAppLinkCode(client: SupabaseClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateWhatsAppLinkCode();
    const { data, error } = await client.from("whatsapp_authorized_numbers").select("id").eq("link_code", code).maybeSingle();
    if (error) throw new ManagementActionError(error.message, 500);
    if (!data) return code;
  }
  throw new ManagementActionError("Could not generate a unique WhatsApp link code", 500);
}

function highestRole(rows: Array<Record<string, any>> | null | undefined): string {
  const roles = (rows ?? []).map((row) => String(row.role ?? ""));
  if (roles.includes("admin")) return "admin";
  if (roles.includes("supervisor")) return "supervisor";
  if (roles.includes("guard")) return "guard";
  return "guard";
}

async function resolveWhatsAppTarget(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>) {
  const targetUserId = typeof input.target_user_id === "string" ? input.target_user_id.trim() : "";
  const target = text(input.target_user ?? input.display_name, "MX Patrol user", { min: 2, max: 120 });
  let profile: Record<string, any> | null = null;

  if (targetUserId) {
    const { data, error } = await client.from("profiles").select("id, full_name, phone, company_id").eq("company_id", actor.company_id).eq("id", targetUserId).maybeSingle();
    if (error) throw new ManagementActionError(error.message, 500);
    profile = data;
  } else {
    const normalizedTargetPhone = normalizeWhatsAppPhone(target);
    const safeTarget = target.replace(/[%,]/g, "");
    const filter = normalizedTargetPhone ? "full_name.ilike.%" + safeTarget + "%,phone.eq." + normalizedTargetPhone : "full_name.ilike.%" + safeTarget + "%";
    const { data, error } = await client.from("profiles").select("id, full_name, phone, company_id").eq("company_id", actor.company_id).or(filter).limit(2);
    if (error) throw new ManagementActionError(error.message, 500);
    if ((data ?? []).length > 1) throw new ManagementActionError("More than one MX Patrol user matched. Select the exact user in the Web Assistant or use the full name.", 409);
    profile = data?.[0] ?? null;
  }

  if (!profile?.id) throw new ManagementActionError("Target MX Patrol user was not found in your company", 404);

  const { data: roles, error: roleError } = await client.from("user_roles").select("role").eq("user_id", profile.id);
  if (roleError) throw new ManagementActionError(roleError.message, 500);
  const role = highestRole(roles);

  const { data: guard } = await client.from("guards").select("id, full_name, phone").eq("company_id", actor.company_id).eq("user_id", profile.id).limit(1).maybeSingle();

  return {
    user_id: profile.id as string,
    guard_id: guard?.id ?? null,
    display_name: profile.full_name ?? guard?.full_name ?? target,
    profile_phone: normalizeWhatsAppPhone(profile.phone ?? guard?.phone ?? ""),
    role,
  };
}

function whatsappAuthorizationRecord(row: Record<string, any>) {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    display_name: row.display_name,
    phone: row.phone,
    masked_phone: maskPhone(row.phone),
    status: row.status,
    link_code: row.status === "pending" ? row.link_code : null,
    link_code_expires_at: row.link_code_expires_at,
    linked_at: row.linked_at,
    last_seen_at: row.last_seen_at,
    allowed_site_ids: Array.isArray(row.allowed_site_ids) ? row.allowed_site_ids : [],
    access_type: meta.access_type ?? "user",
    site_name: meta.site_name ?? null,
  };
}

export async function createWhatsAppAuthorization(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const target = await resolveWhatsAppTarget(client, actor, input);
  const accessType = String(input.access_type ?? "user").toLowerCase() === "management" ? "management" : "user";
  if (accessType === "management" && !["admin", "supervisor"].includes(target.role)) {
    throw new ManagementActionError("Management WhatsApp access can only be linked to an admin or supervisor account", 403);
  }

  const requestedPhone = normalizeWhatsAppPhone(input.phone) || target.profile_phone;
  if (!requestedPhone) throw new ManagementActionError("WhatsApp phone number is required");

  const { data: active, error: activeError } = await client.from("whatsapp_authorized_numbers").select("id, display_name, phone, status, allowed_site_ids, linked_at, last_seen_at, metadata").eq("company_id", actor.company_id).eq("phone", requestedPhone).eq("status", "active").maybeSingle();
  if (activeError) throw new ManagementActionError(activeError.message, 500);
  if (active) {
    return { ok: true, action: "create_whatsapp_authorization", duplicate: true, record: whatsappAuthorizationRecord(active), summary: (active.display_name ?? requestedPhone) + " is already authorized for WhatsApp." };
  }

  const code = await uniqueWhatsAppLinkCode(client);
  const expiresAt = new Date(Date.now() + WHATSAPP_LINK_TTL_MS).toISOString();
  const row = {
    company_id: actor.company_id,
    user_id: target.user_id,
    guard_id: target.guard_id,
    phone: requestedPhone,
    display_name: target.display_name,
    status: "pending",
    link_code: code,
    link_code_expires_at: expiresAt,
    allowed_site_ids: [site.id],
    authorized_by: actor.user_id ?? null,
    metadata: { access_type: accessType, role: target.role, site_id: site.id, site_name: site.name, created_via: String(input.created_via ?? "management_ai") },
  };

  const { data: reusable, error: reusableError } = await client
    .from("whatsapp_authorized_numbers")
    .select("id")
    .eq("company_id", actor.company_id)
    .eq("phone", requestedPhone)
    .neq("status", "active")
    .maybeSingle();
  if (reusableError) throw new ManagementActionError(reusableError.message, 500);

  const write = reusable?.id
    ? client.from("whatsapp_authorized_numbers").update(row).eq("id", reusable.id).eq("company_id", actor.company_id)
    : client.from("whatsapp_authorized_numbers").insert(row);
  const { data, error } = await write
    .select("id, display_name, phone, status, link_code, link_code_expires_at, linked_at, last_seen_at, allowed_site_ids, metadata")
    .maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("WhatsApp authorization could not be created", 500);

  return {
    ok: true,
    action: "create_whatsapp_authorization",
    duplicate: false,
    record: whatsappAuthorizationRecord(data),
    summary: "Link code " + code + " created for " + target.display_name + ". They must send this code from " + requestedPhone + " within 24 hours to activate WhatsApp access for " + site.name + ".",
  };
}

export async function listWhatsAppAuthorizations(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const { data, error } = await client.from("whatsapp_authorized_numbers").select("id, display_name, phone, status, link_code, link_code_expires_at, linked_at, last_seen_at, allowed_site_ids, metadata").eq("company_id", actor.company_id).order("created_at", { ascending: false }).limit(50);
  if (error) throw new ManagementActionError(error.message, 500);
  const rows = (data ?? []).filter((row: Record<string, any>) => !Array.isArray(row.allowed_site_ids) || !row.allowed_site_ids.length || row.allowed_site_ids.includes(site.id)).map(whatsappAuthorizationRecord);
  return { ok: true, action: "list_whatsapp_authorizations", duplicate: false, record: { site_id: site.id, site_name: site.name, rows, count: rows.length }, summary: rows.length + " WhatsApp authorization" + (rows.length === 1 ? "" : "s") + " found for " + site.name + "." };
}

export async function revokeWhatsAppAuthorization(client: SupabaseClient, actor: ManagementActor, input: Record<string, unknown>): Promise<ManagementResult> {
  assertCanManage(actor);
  const site = await resolveSite(client, actor, input.site_id);
  const id = typeof input.authorization_id === "string" ? input.authorization_id.trim() : "";
  const phone = normalizeWhatsAppPhone(input.phone);
  if (!id && !phone) throw new ManagementActionError("Choose an authorized WhatsApp number to revoke");

  let query = client.from("whatsapp_authorized_numbers").select("id, display_name, phone, status, allowed_site_ids, metadata").eq("company_id", actor.company_id);
  query = id ? query.eq("id", id) : query.eq("phone", phone);
  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) throw new ManagementActionError(findError.message, 500);
  if (!existing) throw new ManagementActionError("WhatsApp authorization was not found", 404);
  if (Array.isArray(existing.allowed_site_ids) && existing.allowed_site_ids.length && !existing.allowed_site_ids.includes(site.id)) {
    throw new ManagementActionError("That WhatsApp authorization belongs to another site", 403);
  }

  const metadata = { ...((existing.metadata ?? {}) as Record<string, unknown>), revoked_by: actor.user_id ?? null, revoked_at: new Date().toISOString() };
  const { data, error } = await client.from("whatsapp_authorized_numbers").update({ status: "revoked", link_code: null, link_code_expires_at: null, metadata }).eq("id", existing.id).eq("company_id", actor.company_id).select("id, display_name, phone, status, link_code, link_code_expires_at, linked_at, last_seen_at, allowed_site_ids, metadata").maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  if (!data) throw new ManagementActionError("WhatsApp authorization could not be revoked", 500);
  if (existing.phone) await client.from("whatsapp_sessions").delete().eq("phone", existing.phone);

  return { ok: true, action: "revoke_whatsapp_authorization", duplicate: false, record: whatsappAuthorizationRecord(data), summary: "WhatsApp access revoked for " + (existing.display_name ?? maskPhone(existing.phone)) + " at " + site.name + "." };
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
    case "create_whatsapp_authorization":
      return await createWhatsAppAuthorization(client, actor, input);
    case "list_whatsapp_authorizations":
      return await listWhatsAppAuthorizations(client, actor, input);
    case "revoke_whatsapp_authorization":
      return await revokeWhatsAppAuthorization(client, actor, input);
    default:
      throw new ManagementActionError(`Unsupported management action: ${action}`, 400);
  }
}
