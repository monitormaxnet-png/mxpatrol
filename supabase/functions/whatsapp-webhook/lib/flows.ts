// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import type { Identity, OutMessage, SessionRow, SiteRow } from "./types.ts";
import { allowedSites } from "./identity.ts";
import { clearFlow, patchSession } from "./session.ts";
import { formatSecureDeviceLabel, getSecureDeviceRows, requestSecureDeviceCommand, type SecureDeviceAction } from "../../_shared/secure-device-management.ts";
import { ManagementActionError, runManagementAction, type ManagementActor, type ManagementResult } from "../../_shared/management-actions.ts";
import { DATA_LOG_FIELD_TYPES, parseOptions, pickFieldType } from "../../_shared/data-log-fields.ts";

/** Maps the WhatsApp identity onto the canonical management actor (same service the Web Management AI uses). */
function managementActor(identity: Identity): ManagementActor {
  return {
    company_id: identity.company_id,
    user_id: identity.user_id,
    guard_id: identity.guard_id,
    role: identity.role,
    canManage: identity.canManage,
    allowed_site_ids: identity.allowed_site_ids ?? [],
  };
}

/** Runs a canonical management action and normalises failures into a WhatsApp message. */
async function callManagement(
  client: SupabaseClient,
  identity: Identity,
  action: string,
  input: Record<string, unknown>,
): Promise<{ result: ManagementResult | null; message: string }> {
  try {
    const result = await runManagementAction(client, managementActor(identity), action, input);
    return { result, message: result.summary };
  } catch (error) {
    const message = error instanceof ManagementActionError || error instanceof Error ? error.message : "Management action failed";
    console.error(`[WA] management action ${action} failed:`, message);
    return { result: null, message };
  }
}

export type FlowResult = { message: OutMessage; session: SessionRow };


const CANCELLED: OutMessage = {
  title: "CANCELLED",
  lines: ["No changes were made."],
  options: [{ id: "menu", label: "Main Menu" }],
};

function siteOptions(sites: SiteRow[]) {
  return sites.slice(0, 9).map((site) => ({ id: `site:${site.id}`, label: site.name }));
}

function pickChoice<T>(input: string, items: T[], label: (item: T) => string): T | null {
  const trimmed = input.trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= items.length) return items[index - 1];
  const lower = trimmed.toLowerCase();
  return items.find((item) => label(item).toLowerCase() === lower)
    ?? items.find((item) => label(item).toLowerCase().includes(lower) && lower.length > 2)
    ?? null;
}

/* ---------------------------------- start ---------------------------------- */

export async function startFlow(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  flow: "REGISTER_DEVICE" | "CREATE_CHECKPOINT" | "CREATE_PATROL" | "REPORT_INCIDENT",
): Promise<FlowResult> {
  if (!identity.canManage) {
    return {
      session,
      message: {
        title: "MANAGEMENT ACCESS UNAVAILABLE",
        lines: ["Your account does not have permission to use management actions."],
        options: [{ id: "menu", label: "Main Menu" }],
      },
    };
  }
  if (flow === "REPORT_INCIDENT") {
    const next = await patchSession(client, session, {
      current_flow: flow,
      current_step: "WAITING_FOR_DESCRIPTION",
      temporary_data: {},
    });
    return {
      session: next,
      message: { title: "REPORT INCIDENT", lines: ["What happened?"], footer: "Type *cancel* to stop." },
    };
  }

  if (flow === "REGISTER_DEVICE") {
    const next = await patchSession(client, session, {
      current_flow: flow,
      current_step: "WAITING_FOR_NAME",
      temporary_data: {},
    });
    return {
      session: next,
      message: {
        title: "REGISTER DEVICE",
        lines: ["We'll guide you through the setup.", "", "What would you like to call this device?"],
        footer: "Type *cancel* to stop.",
      },
    };
  }

  if (flow === "CREATE_CHECKPOINT") {
    const next = await patchSession(client, session, {
      current_flow: flow,
      current_step: "WAITING_FOR_NAME",
      temporary_data: {},
    });
    return {
      session: next,
      message: {
        title: "ADD CHECKPOINT",
        lines: ["What should this checkpoint be called?"],
        footer: "Type *cancel* to stop.",
      },
    };
  }

  const next = await patchSession(client, session, {
    current_flow: flow,
    current_step: "WAITING_FOR_NAME",
    temporary_data: {},
  });
  return {
    session: next,
    message: { title: "CREATE PATROL", lines: ["What should this patrol be called?"], footer: "Type *cancel* to stop." },
  };
}

/* ---------------------------------- router --------------------------------- */

export async function handleFlowInput(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  input: string,
  mediaUrls: string[],
): Promise<FlowResult> {
  const lower = input.trim().toLowerCase();
  if (["cancel", "stop", "exit"].includes(lower)) {
    return { session: await clearFlow(client, session), message: CANCELLED };
  }

  switch (session.current_flow) {
    case "REGISTER_DEVICE":
      return await registerDevice(client, identity, session, input);
    case "CREATE_CHECKPOINT":
      return await createCheckpoint(client, identity, session, input);
    case "CREATE_PATROL":
      return await createPatrol(client, identity, session, input);
    case "REPORT_INCIDENT":
      return await reportIncident(client, identity, session, input, mediaUrls);
    case "SECURE_DEVICE_ACTION":
      return await secureDeviceAction(client, identity, session, input);
    default:
      return { session: await clearFlow(client, session), message: CANCELLED };
  }
}

/* ------------------------------ register device ---------------------------- */

const DEVICE_TYPE_OPTIONS = [
  { id: "mobile", label: "Mobile patrol device" },
  { id: "pda", label: "RG360 / PDA" },
  { id: "nfc_reader", label: "NFC reader" },
  { id: "tablet", label: "Tablet" },
];


async function registerDevice(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  input: string,
): Promise<FlowResult> {
  const data = { ...(session.temporary_data ?? {}) } as Record<string, any>;

  if (session.current_step === "WAITING_FOR_NAME") {
    data.device_name = input.trim().slice(0, 80);
    const next = await patchSession(client, session, {
      current_step: "WAITING_FOR_TYPE",
      temporary_data: data,
    });
    return {
      session: next,
      message: {
        title: "DEVICE TYPE",
        lines: ["What kind of device is this?"],
        options: DEVICE_TYPE_OPTIONS.map((o, i) => ({ id: String(i + 1), label: o.label })),
        footer: "Type *cancel* to stop.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_TYPE") {
    const choice = pickChoice(input, DEVICE_TYPE_OPTIONS, (o) => o.label);
    if (!choice) {
      return {
        session,
        message: {
          title: "DEVICE TYPE",
          lines: ["Reply with one of the numbers listed."],
          options: DEVICE_TYPE_OPTIONS.map((o, i) => ({ id: String(i + 1), label: o.label })),
        },
      };
    }
    data.device_type = choice.id;
    data.device_type_label = choice.label;
    const sites = await allowedSites(client, identity);
    data.site_choices = sites;
    const next = await patchSession(client, session, {
      current_step: "WAITING_FOR_SITE",
      temporary_data: data,
    });
    return {
      session: next,
      message: { title: "SELECT SITE", lines: ["Which site is this device for?"], options: siteOptions(sites) },
    };
  }

  if (session.current_step === "WAITING_FOR_SITE") {
    const sites = (data.site_choices ?? []) as SiteRow[];
    const site = pickChoice(input, sites, (s) => s.name);
    if (!site) {
      return { session, message: { title: "SELECT SITE", lines: ["I didn't catch that site."], options: siteOptions(sites) } };
    }
    data.site_id = site.id;
    data.site_name = site.name;
    const next = await patchSession(client, session, {
      current_step: "WAITING_FOR_CODE",
      temporary_data: data,
    });
    return {
      session: next,
      message: {
        title: "PAIRING CODE",
        lines: [
          "Open MX Patrol on the physical patrol device. While it is unpaired it shows a pairing code.",
          "Send me that code exactly as displayed.",
          "",
          "Example: MX-48768",
        ],
        footer: "Type *cancel* to stop.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CODE") {
    const code = input.trim().toUpperCase().replace(/^MXP?[-\s]?/, "").replace(/[\s-]/g, "");
    if (!/^[A-Z0-9]{5,10}$/.test(code)) {
      return {
        session,
        message: {
          title: "CODE NOT RECOGNISED",
          lines: ["That does not look like a pairing code.", "Send the code shown on the MX Patrol device, e.g. MX-48768."],
          footer: "Type *cancel* to stop.",
        },
      };
    }

    data.pairing_code = code;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return {
      session: next,
      message: {
        title: "REGISTER DEVICE — CONFIRM",
        lines: [
          `Device Name: ${data.device_name}`,
          `Device Type: ${data.device_type_label}`,
          `Assigned Site: ${data.site_name}`,
          `Pairing Code: MX-${code}`,
          "",
          "This pairing code must match the code currently displayed on the physical MX Patrol device.",
          "Reply *confirm* to bind this physical device to the new device record, or *cancel* to discard.",
        ],
        options: [{ id: "confirm", label: "Confirm" }, { id: "cancel", label: "Cancel" }],
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (!/^(1|confirm|yes|y)$/i.test(input.trim())) {
      return { session: await clearFlow(client, session), message: CANCELLED };
    }

    const outcome = await callManagement(client, identity, "register_device", {
      site_id: data.site_id,
      device_name: data.device_name,
      device_type: data.device_type,
      pairing_code: data.pairing_code,
      enrolled_via: "whatsapp_management_ai",
    });

    if (!outcome.result) {
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT REGISTER", lines: [outcome.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    return {
      session: await clearFlow(client, session),
      message: {
        title: outcome.result.duplicate ? "DEVICE ALREADY REGISTERED" : "✅ DEVICE REGISTERED",
        lines: [outcome.result.summary],
        options: [{ id: "devices", label: "View Devices" }, { id: "menu", label: "Main Menu" }],
      },
    };
  }


  return { session: await clearFlow(client, session), message: CANCELLED };
}

/* ------------------------------ add checkpoint ----------------------------- */

const DATA_LOG_OPTIONS = [
  { id: "1", label: "None" },
  { id: "2", label: "Choose Existing Form" },
  { id: "3", label: "Create New Form" },
  { id: "4", label: "Back" },
];

const FIELD_TYPE_LINES = DATA_LOG_FIELD_TYPES.map((type, index) => `${index + 1}. ${type.label}`).join("\n");

const REQUIRED_OPTIONS = [{ id: "1", label: "Required" }, { id: "2", label: "Optional" }];
const ADD_ANOTHER_OPTIONS = [{ id: "1", label: "Add another field" }, { id: "2", label: "Done" }];

type PendingField = { label: string; field_type: string; required: boolean; options_json: string[]; sequence_order: number };

function pendingFields(data: Record<string, any>): PendingField[] {
  return Array.isArray(data.pending_form?.fields) ? (data.pending_form.fields as PendingField[]) : [];
}

function describeFields(data: Record<string, any>): string[] {
  return pendingFields(data).map((field, index) => {
    const typeLabel = DATA_LOG_FIELD_TYPES.find((type) => type.id === field.field_type)?.label ?? field.field_type;
    const options = field.options_json?.length ? ` [${field.options_json.join(", ")}]` : "";
    return `  ${index + 1}. ${field.label} - ${typeLabel}${field.required ? " (required)" : " (optional)"}${options}`;
  });
}

function dataLogOptionSummary(data: Record<string, any>) {
  if (!data.data_log_choice || data.data_log_choice === "none") return "No form";
  if (data.data_log_form_name) return String(data.data_log_form_name);
  if (data.pending_form?.name) return String(data.pending_form.name);
  return "Data Log Form";
}

async function createCheckpoint(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  input: string,
): Promise<FlowResult> {
  const data = { ...(session.temporary_data ?? {}) } as Record<string, any>;

  if (session.current_step === "WAITING_FOR_NAME") {
    data.checkpoint_name = input.trim().slice(0, 80);
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_ZONE", temporary_data: data });
    return { session: next, message: { title: "1/6 - CHECKPOINT NAME", lines: ["Checkpoint name: " + data.checkpoint_name, "", "2/6 - Zone / Location", "Reply with the zone or location."] } };
  }

  if (session.current_step === "WAITING_FOR_ZONE") {
    data.location_note = input.trim().slice(0, 120);
    const sites = await allowedSites(client, identity);
    data.site_choices = sites;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_SITE", temporary_data: data });
    return { session: next, message: { title: "3/6 - SITE", lines: ["Zone / Location: " + data.location_note, "Which site should this checkpoint belong to?"], options: siteOptions(sites) } };
  }

  if (session.current_step === "WAITING_FOR_SITE") {
    const sites = (data.site_choices ?? []) as SiteRow[];
    const site = pickChoice(input, sites, (s) => s.name);
    if (!site) return { session, message: { title: "SELECT SITE", lines: ["I didn't catch that site."], options: siteOptions(sites) } };
    data.site_id = site.id;
    data.site_name = site.name;

    await client.from("whatsapp_nfc_capture_requests").update({ status: "cancelled" }).eq("phone", identity.phone).eq("status", "waiting");
    const { data: request, error } = await client
      .from("whatsapp_nfc_capture_requests")
      .insert({ company_id: identity.company_id, site_id: site.id, session_id: session.id, phone: identity.phone, requested_by: identity.user_id, purpose: "create_checkpoint", checkpoint_name: data.checkpoint_name, status: "waiting" })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[WA] nfc capture request failed:", error.message);
      return { session: await clearFlow(client, session), message: { title: "COULD NOT START", lines: [error.message], options: [{ id: "menu", label: "Main Menu" }] } };
    }

    data.capture_request_id = request?.id;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_NFC", temporary_data: data });
    return {
      session: next,
      message: {
        title: "4/6 - NFC TAG ASSIGNMENT",
        lines: [
          "Use an enrolled MX Patrol device to scan the NFC tag for:",
          "",
          "Checkpoint: " + data.checkpoint_name,
          "Zone: " + data.location_note,
          "Site: " + site.name,
          "",
          "Do not scan through WhatsApp. I will continue once MX Patrol captures the NFC tag.",
        ],
        footer: "Type cancel to stop.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_NFC") {
    const { data: request } = await client.from("whatsapp_nfc_capture_requests").select("id, status, nfc_tag_id, device_identifier").eq("id", data.capture_request_id).maybeSingle();
    if (request?.status === "captured" && request.nfc_tag_id) {
      data.nfc_tag_id = request.nfc_tag_id;
      data.nfc_device_identifier = request.device_identifier;
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_DATA_LOG", temporary_data: data });
      return { session: next, message: { title: "5/6 - DATA LOG FORM", lines: ["NFC tag assigned successfully.", "", "Should this checkpoint collect additional information when scanned?"], options: DATA_LOG_OPTIONS } };
    }
    return { session, message: { title: "STILL WAITING", lines: ["No tag has been scanned yet. Tap the NFC tag with an enrolled MX Patrol device."], footer: "Type cancel to stop." } };
  }

  if (session.current_step === "WAITING_FOR_DATA_LOG") {
    const choice = input.trim().toLowerCase();

    if (/^(1|no|none|no form)$/.test(choice)) {
      data.data_log_choice = "none";
      data.data_log_form_id = null;
      data.pending_form = null;
      data.data_log_field_count = null;
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
      return await createCheckpoint(client, identity, next, "summary");
    }

    if (/^(2|existing|choose existing|use existing)/.test(choice)) {
      const { data: forms, error } = await client
        .from("data_log_forms")
        .select("id, name, form_type, site_id, data_log_form_fields(id)")
        .eq("company_id", identity.company_id)
        .eq("is_active", true)
        .or("site_id.is.null,site_id.eq." + data.site_id)
        .order("name", { ascending: true })
        .limit(9);
      if (error) return { session, message: { title: "FORM LOOKUP FAILED", lines: [error.message], options: DATA_LOG_OPTIONS } };
      const usable = (forms ?? []).filter((form: any) => Array.isArray(form.data_log_form_fields) && form.data_log_form_fields.length > 0);
      if (!usable.length) return { session, message: { title: "NO FORMS FOUND", lines: ["No reusable Data Log Forms are available for this site yet.", "Choose 3 to create one now."], options: DATA_LOG_OPTIONS } };
      data.form_choices = usable;
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_EXISTING_FORM", temporary_data: data });
      return { session: next, message: { title: "SELECT DATA LOG FORM", lines: usable.map((form: any, index: number) => String(index + 1) + ". " + form.name + " (" + form.data_log_form_fields.length + " fields)"), footer: "Reply with the form number, or cancel." } };
    }

    if (/^(3|new|create|create new form)/.test(choice)) {
      data.data_log_choice = "new";
      data.data_log_form_id = null;
      data.pending_form = { name: "", fields: [] };
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_FORM_NAME", temporary_data: data });
      return { session: next, message: { title: "NEW DATA LOG FORM", lines: ["What should the new Data Log Form be called?"], footer: "Type cancel to stop." } };
    }

    if (/^(4|back)/.test(choice)) {
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_ZONE", temporary_data: data });
      return { session: next, message: { title: "2/6 - ZONE / LOCATION", lines: ["Reply with the zone or location."] } };
    }

    return { session, message: { title: "DATA LOG FORM", lines: ["Choose how data should be collected when this checkpoint is scanned."], options: DATA_LOG_OPTIONS } };
  }

  if (session.current_step === "WAITING_FOR_FORM_NAME") {
    const name = input.trim().slice(0, 120);
    if (name.length < 2) return { session, message: { title: "NEW DATA LOG FORM", lines: ["Form names need at least 2 characters."] } };
    data.pending_form = { name, fields: [] };
    data.data_log_form_name = name;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_LABEL", temporary_data: data });
    return { session: next, message: { title: "FIELD 1 - LABEL", lines: ["Form: " + name, "", "What should the first field be called? e.g. Door locked?"] } };
  }

  if (session.current_step === "WAITING_FOR_FIELD_LABEL") {
    const label = input.trim().slice(0, 120);
    if (label.length < 2) return { session, message: { title: "FIELD LABEL", lines: ["Field labels need at least 2 characters."] } };
    data.draft_field = { label, field_type: "", required: false, options_json: [] };
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_TYPE", temporary_data: data });
    return { session: next, message: { title: "FIELD TYPE", lines: ["Field: " + label, "", FIELD_TYPE_LINES], footer: "Reply with the field type number." } };
  }

  if (session.current_step === "WAITING_FOR_FIELD_TYPE") {
    const type = pickFieldType(input);
    if (!type) return { session, message: { title: "FIELD TYPE", lines: ["I didn't catch that field type.", "", FIELD_TYPE_LINES] } };
    data.draft_field = { ...(data.draft_field ?? {}), field_type: type.id };
    if (type.needsOptions) {
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_OPTIONS", temporary_data: data });
      return { session: next, message: { title: "FIELD OPTIONS", lines: ["List the choices for " + data.draft_field.label + ", separated by commas.", "e.g. Clear, Minor issue, Escalate"] } };
    }
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_REQUIRED", temporary_data: data });
    return { session: next, message: { title: "REQUIRED?", lines: ["Is \"" + data.draft_field.label + "\" required?"], options: REQUIRED_OPTIONS } };
  }

  if (session.current_step === "WAITING_FOR_FIELD_OPTIONS") {
    const options = parseOptions(input);
    if (options.length < 2) return { session, message: { title: "FIELD OPTIONS", lines: ["Provide at least two comma-separated options."] } };
    data.draft_field = { ...(data.draft_field ?? {}), options_json: options };
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_REQUIRED", temporary_data: data });
    return { session: next, message: { title: "REQUIRED?", lines: ["Options: " + options.join(", "), "", "Is \"" + data.draft_field.label + "\" required?"], options: REQUIRED_OPTIONS } };
  }

  if (session.current_step === "WAITING_FOR_FIELD_REQUIRED") {
    const answer = input.trim().toLowerCase();
    if (!/^(1|2|yes|no|required|optional|y|n)$/.test(answer)) {
      return { session, message: { title: "REQUIRED?", lines: ["Reply 1 for required or 2 for optional."], options: REQUIRED_OPTIONS } };
    }
    const required = /^(1|yes|y|required)$/.test(answer);
    const draft = data.draft_field ?? {};
    const fields = pendingFields(data);
    fields.push({
      label: String(draft.label ?? ""),
      field_type: String(draft.field_type ?? "text"),
      required,
      options_json: Array.isArray(draft.options_json) ? draft.options_json : [],
      sequence_order: fields.length + 1,
    });
    data.pending_form = { ...(data.pending_form ?? {}), fields };
    data.draft_field = null;
    data.data_log_field_count = fields.length;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_MORE", temporary_data: data });
    return { session: next, message: { title: "ADD ANOTHER FIELD?", lines: ["Form: " + data.pending_form.name, ...describeFields(data), "", "Add another field?"], options: ADD_ANOTHER_OPTIONS } };
  }

  if (session.current_step === "WAITING_FOR_FIELD_MORE") {
    const answer = input.trim().toLowerCase();
    if (/^(1|yes|y|add|another)/.test(answer)) {
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_LABEL", temporary_data: data });
      return { session: next, message: { title: "FIELD " + (pendingFields(data).length + 1) + " - LABEL", lines: ["What should the next field be called?"] } };
    }
    if (!/^(2|no|n|done|continue)/.test(answer)) {
      return { session, message: { title: "ADD ANOTHER FIELD?", lines: ["Reply 1 to add another field or 2 when done."], options: ADD_ANOTHER_OPTIONS } };
    }
    if (!pendingFields(data).length) {
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_FIELD_LABEL", temporary_data: data });
      return { session: next, message: { title: "FIELD 1 - LABEL", lines: ["A Data Log Form needs at least one field. What should the first field be called?"] } };
    }
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return await createCheckpoint(client, identity, next, "summary");
  }

  if (session.current_step === "WAITING_FOR_EXISTING_FORM") {
    const forms = (data.form_choices ?? []) as Array<any>;
    const form = pickChoice(input, forms, (f) => f.name);
    if (!form) return { session, message: { title: "SELECT DATA LOG FORM", lines: ["I didn't catch that form."], options: forms.map((f, index) => ({ id: String(index + 1), label: f.name })) } };
    data.data_log_choice = "existing";
    data.data_log_form_id = form.id;
    data.data_log_form_name = form.name;
    data.data_log_form_type = form.form_type;
    data.pending_form = null;
    data.data_log_field_count = Array.isArray(form.data_log_form_fields) ? form.data_log_form_fields.length : 0;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return await createCheckpoint(client, identity, next, "summary");
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (input.trim().toLowerCase() === "summary") {
      return {
        session,
        message: {
          title: "REGISTER CHECKPOINT - CONFIRM",
          lines: [
            "Checkpoint: " + data.checkpoint_name,
            "Zone / Location: " + data.location_note,
            "Site: " + data.site_name,
            "NFC: " + (data.nfc_tag_id ? "assigned" : "pending"),
            "Data Log Form: " + dataLogOptionSummary(data),
            data.data_log_field_count != null ? "Fields: " + data.data_log_field_count : null,
            ...(data.data_log_choice === "new" ? describeFields(data) : []),
            "",
            "Reply confirm to save, or cancel to discard.",
          ].filter(Boolean) as string[],
          options: [{ id: "1", label: "Register Checkpoint" }, { id: "2", label: "Cancel" }],
        },
      };
    }

    if (!/^(1|confirm|yes|y|register|create)/i.test(input.trim())) {
      await client.from("whatsapp_nfc_capture_requests").update({ status: "cancelled" }).eq("id", data.capture_request_id);
      return { session: await clearFlow(client, session), message: CANCELLED };
    }

    const outcome = await callManagement(client, identity, "create_checkpoint", {
      site_id: data.site_id,
      name: data.checkpoint_name,
      location_note: data.location_note,
      nfc_tag_id: data.nfc_tag_id,
      data_log_form_id: data.data_log_choice === "existing" ? data.data_log_form_id ?? null : null,
      new_form: data.data_log_choice === "new" && data.pending_form ? data.pending_form : null,
    });

    if (!outcome.result) {
      return { session: await clearFlow(client, session), message: { title: "COULD NOT CREATE", lines: [outcome.message], options: [{ id: "menu", label: "Main Menu" }] } };
    }

    await client.from("whatsapp_nfc_capture_requests").update({ status: "completed" }).eq("id", data.capture_request_id);
    const record = outcome.result.record as Record<string, any>;
    return { session: await clearFlow(client, session), message: { title: outcome.result.duplicate ? "CHECKPOINT ALREADY EXISTS" : "OK - " + data.checkpoint_name + " created", lines: [outcome.result.summary, "Zone: " + (data.location_note ?? "-"), "Site: " + data.site_name, "Data Log Form: " + (record.data_log_form_name ?? dataLogOptionSummary(data)), "Status: Active"], options: [{ id: "setup", label: "Setup" }, { id: "menu", label: "Main Menu" }] } };
  }

  return { session: await clearFlow(client, session), message: CANCELLED };
}

/* ------------------------------ create patrol ------------------------------ */

const YES_NO = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

function yesNoChoice(input: string): { id: string; label: string } | null {
  return pickChoice(input, YES_NO, (option) => option.label);
}

async function createPatrol(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  input: string,
): Promise<FlowResult> {
  const data = { ...(session.temporary_data ?? {}) } as Record<string, any>;

  if (session.current_step === "WAITING_FOR_NAME") {
    data.patrol_name = input.trim().slice(0, 80);
    const sites = await allowedSites(client, identity);
    data.site_choices = sites;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_SITE", temporary_data: data });
    return { session: next, message: { title: "CREATE PATROL TEMPLATE", lines: ["Which site is this patrol template for?"], options: siteOptions(sites) } };
  }

  if (session.current_step === "WAITING_FOR_SITE") {
    const sites = (data.site_choices ?? []) as SiteRow[];
    const site = pickChoice(input, sites, (s) => s.name);
    if (!site) {
      return { session, message: { title: "SELECT SITE", lines: ["I didn't catch that site."], options: siteOptions(sites) } };
    }
    data.site_id = site.id;
    data.site_name = site.name;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_DURATION", temporary_data: data });
    return { session: next, message: { title: "EXPECTED DURATION", lines: ["How many minutes should one patrol take? e.g. 45"], footer: "Type *cancel* to stop." } };
  }

  if (session.current_step === "WAITING_FOR_DURATION") {
    const duration = Number(input.trim());
    if (!Number.isFinite(duration) || duration < 5 || duration > 1440) {
      return { session, message: { title: "EXPECTED DURATION", lines: ["Send a duration in minutes between 5 and 1440."], footer: "Type *cancel* to stop." } };
    }
    data.expected_duration_minutes = Math.round(duration);
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_DESCRIPTION", temporary_data: data });
    return { session: next, message: { title: "DESCRIPTION / PURPOSE", lines: ["What is the purpose of this patrol? e.g. Night perimeter inspection"], footer: "Type *cancel* to stop." } };
  }

  if (session.current_step === "WAITING_FOR_DESCRIPTION") {
    const description = input.trim().slice(0, 500);
    if (description.length < 3) {
      return { session, message: { title: "DESCRIPTION / PURPOSE", lines: ["Please provide at least 3 characters."], footer: "Type *cancel* to stop." } };
    }
    data.description = description;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_SEQUENCE", temporary_data: data });
    return {
      session: next,
      message: {
        title: "SEQUENTIAL SCANNING",
        lines: ["Should routes created from this template require checkpoint scans in order?"],
        options: YES_NO.map((option, index) => ({ id: String(index + 1), label: option.label })),
      },
    };
  }

  if (session.current_step === "WAITING_FOR_SEQUENCE") {
    const choice = yesNoChoice(input);
    if (!choice) {
      return { session, message: { title: "SEQUENTIAL SCANNING", lines: ["Reply with one of the numbers listed."], options: YES_NO.map((option, index) => ({ id: String(index + 1), label: option.label })) } };
    }
    data.sequential_scanning = choice.id;
    data.sequential_scanning_label = choice.label;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_OFFLINE", temporary_data: data });
    return {
      session: next,
      message: {
        title: "OFFLINE SCANS",
        lines: ["Should offline scans be allowed and synced later when supported by the patrol device?"],
        options: YES_NO.map((option, index) => ({ id: String(index + 1), label: option.label })),
      },
    };
  }

  if (session.current_step === "WAITING_FOR_OFFLINE") {
    const choice = yesNoChoice(input);
    if (!choice) {
      return { session, message: { title: "OFFLINE SCANS", lines: ["Reply with one of the numbers listed."], options: YES_NO.map((option, index) => ({ id: String(index + 1), label: option.label })) } };
    }
    data.offline_scans_allowed = choice.id;
    data.offline_scans_allowed_label = choice.label;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return {
      session: next,
      message: {
        title: "CREATE PATROL TEMPLATE - CONFIRM",
        lines: [
          "Patrol Name: " + data.patrol_name,
          "Site: " + data.site_name,
          "Expected Duration: " + data.expected_duration_minutes + " min",
          "Description: " + data.description,
          "",
          "Operational Rules:",
          "- Checkpoints required",
          "- Sequential scanning: " + data.sequential_scanning_label,
          "- Expected completion: " + data.expected_duration_minutes + " min",
          "- Missed checkpoints recorded",
          "- Late / incomplete tracking enabled",
          "- Offline scans allowed: " + data.offline_scans_allowed_label,
          "",
          "Route: Not assigned yet",
          "",
          "Reply confirm to save, or cancel to discard.",
        ],
        options: [{ id: "confirm", label: "Save Template" }, { id: "cancel", label: "Cancel" }],
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (!/^(1|confirm|yes|y|save|create)/i.test(input.trim())) {
      return { session: await clearFlow(client, session), message: CANCELLED };
    }

    const outcome = await callManagement(client, identity, "create_patrol_template", {
      site_id: data.site_id,
      name: data.patrol_name,
      expected_duration_minutes: data.expected_duration_minutes,
      description: data.description,
      operational_rules: {
        checkpoints_required: true,
        sequential_scanning: data.sequential_scanning === "yes",
        expected_duration_enforced: true,
        missed_checkpoints_recorded: true,
        late_start_tracking: true,
        incomplete_patrol_tracking: true,
        offline_scans_allowed: data.offline_scans_allowed === "yes",
      },
    });

    if (!outcome.result) {
      return { session: await clearFlow(client, session), message: { title: "COULD NOT CREATE", lines: [outcome.message], options: [{ id: "menu", label: "Main Menu" }] } };
    }

    return {
      session: await clearFlow(client, session),
      message: {
        title: outcome.result.duplicate ? "PATROL TEMPLATE ALREADY EXISTS" : "PATROL TEMPLATE CREATED",
        lines: [outcome.result.summary, "Route: Not assigned yet", "Next: create a route, then create a schedule."],
        options: [{ id: "routes", label: "Create Route" }, { id: "schedules", label: "Create Schedule" }, { id: "menu", label: "Main Menu" }],
      },
    };
  }

  return { session: await clearFlow(client, session), message: CANCELLED };
}

/* ----------------------------- report incident ----------------------------- */

const SEVERITIES = [
  { id: "low", label: "🟢 Minor" },
  { id: "medium", label: "🟡 Moderate" },
  { id: "high", label: "🟠 Serious" },
  { id: "critical", label: "🔴 Emergency" },
];

async function reportIncident(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  input: string,
  mediaUrls: string[],
): Promise<FlowResult> {
  const data = { ...(session.temporary_data ?? {}) } as Record<string, any>;

  if (session.current_step === "WAITING_FOR_DESCRIPTION") {
    data.description = input.trim().slice(0, 1000);
    if (mediaUrls.length) data.media = mediaUrls;
    const sites = await allowedSites(client, identity);
    data.site_choices = sites;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_SITE", temporary_data: data });
    return { session: next, message: { title: "WHERE?", lines: ["Which site did this happen at?"], options: siteOptions(sites) } };
  }

  if (session.current_step === "WAITING_FOR_SITE") {
    const sites = (data.site_choices ?? []) as SiteRow[];
    const site = pickChoice(input, sites, (s) => s.name);
    if (!site) {
      return { session, message: { title: "WHERE?", lines: ["I didn't catch that site."], options: siteOptions(sites) } };
    }
    data.site_id = site.id;
    data.site_name = site.name;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_SEVERITY", temporary_data: data });
    return { session: next, message: { title: "SEVERITY", lines: ["How serious is it?"], options: SEVERITIES.map((s) => ({ id: s.id, label: s.label })) } };
  }

  if (session.current_step === "WAITING_FOR_SEVERITY") {
    const severity = pickChoice(input, SEVERITIES, (s) => s.label);
    if (!severity) {
      return { session, message: { title: "SEVERITY", lines: ["Choose a severity."], options: SEVERITIES.map((s) => ({ id: s.id, label: s.label })) } };
    }
    data.severity = severity.id;
    data.severity_label = severity.label;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_EVIDENCE", temporary_data: data });
    return {
      session: next,
      message: {
        title: "EVIDENCE",
        lines: ["Send a photo now, or reply *skip*."],
        footer: "Type *cancel* to stop.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_EVIDENCE") {
    if (mediaUrls.length) data.media = [...((data.media as string[]) ?? []), ...mediaUrls];
    const media = (data.media as string[]) ?? [];
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return {
      session: next,
      message: {
        title: "REVIEW INCIDENT",
        lines: [
          data.description,
          data.site_name,
          data.severity_label,
          media.length ? `📷 ${media.length} image${media.length === 1 ? "" : "s"} attached` : "No images attached",
        ],
        options: [{ id: "confirm", label: "Submit" }, { id: "cancel", label: "Cancel" }],
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (!/^(1|confirm|yes|y|submit)/i.test(input.trim())) {
      return { session: await clearFlow(client, session), message: CANCELLED };
    }
    const media = (data.media as string[]) ?? [];
    const outcome = await callManagement(client, identity, "create_incident", {
      site_id: data.site_id,
      description: data.description,
      title: String(data.description).slice(0, 80),
      severity: data.severity,
      image_url: media[0] ?? null,
      source: "whatsapp_report",
    });

    if (!outcome.result) {
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT SUBMIT", lines: [outcome.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    const record = outcome.result.record as Record<string, any>;
    return {
      session: await clearFlow(client, session),
      message: {
        title: outcome.result.duplicate ? "INCIDENT ALREADY LOGGED" : "✅ INCIDENT CREATED",
        lines: [`Reference: ${record.reference}`, `${data.site_name} · ${data.severity_label}`, `Status: ${record.status}`],
        options: [{ id: "incidents", label: "View Incidents" }, { id: "menu", label: "Main Menu" }],
      },
    };
  }

  return { session: await clearFlow(client, session), message: CANCELLED };
}

/* --------------------------- secure device action -------------------------- */

const SECURE_ACTION_LABELS: Record<string, string> = {
  request_device_lock: "Lock Device",
  request_device_disable: "Disable Device",
  request_device_enable: "Enable Device",
  request_maintenance_mode: "Maintenance Mode",
  request_exit_maintenance: "Exit Maintenance",
  request_enable_kiosk_mode: "Enable Kiosk Mode",
  request_disable_kiosk_mode: "Disable Kiosk Mode",
  request_app_update: "Require App Update",
  request_integrity_check: "Run Security Check",
  revoke_device: "Revoke Device",
};

function isKioskSecureAction(action: SecureDeviceAction): boolean {
  return action === "request_enable_kiosk_mode" || action === "request_disable_kiosk_mode";
}

export async function startSecureDeviceAction(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  action: SecureDeviceAction,
  deviceIdentifier?: string | null,
): Promise<FlowResult> {
  if (!identity.canManage) {
    return { session, message: { title: "MANAGEMENT ACCESS UNAVAILABLE", lines: ["Your account does not have permission to manage secure patrol devices."], options: [{ id: "menu", label: "Main Menu" }] } };
  }
  if (isKioskSecureAction(action) && !identity.canManageKiosk) {
    return { session, message: { title: "KIOSK ACCESS UNAVAILABLE", lines: ["Only MX Patrol platform owners or system operators can manage Kiosk Mode."], options: [{ id: "secure_devices", label: "Secure Device Menu" }] } };
  }

  const data: Record<string, any> = { secure_action: action };
  if (deviceIdentifier) {
    data.device_identifier = deviceIdentifier;
    const step = action === "request_maintenance_mode" ? "WAITING_FOR_DURATION" : "WAITING_FOR_CONFIRM";
    const next = await patchSession(client, session, { current_flow: "SECURE_DEVICE_ACTION", current_step: step, temporary_data: data });
    return await secureDeviceAction(client, identity, next, "summary");
  }

  const rows = await getSecureDeviceRows(client, identity, session.current_site_id);
  data.device_choices = rows.slice(0, 9);
  const next = await patchSession(client, session, { current_flow: "SECURE_DEVICE_ACTION", current_step: "WAITING_FOR_DEVICE", temporary_data: data });
  return {
    session: next,
    message: {
      title: SECURE_ACTION_LABELS[action] ?? "Secure Device Action",
      lines: ["Which device do you want to manage?"],
      options: data.device_choices.map((row: Record<string, any>) => ({ id: String(row.device_identifier), label: formatSecureDeviceLabel(row) })),
      footer: "Type cancel to stop.",
    },
  };
}

async function secureDeviceAction(client: SupabaseClient, identity: Identity, session: SessionRow, input: string): Promise<FlowResult> {
  const data = { ...(session.temporary_data ?? {}) } as Record<string, any>;
  const action = data.secure_action as SecureDeviceAction;
  if (isKioskSecureAction(action) && !identity.canManageKiosk) {
    return { session: await clearFlow(client, session), message: { title: "KIOSK ACCESS UNAVAILABLE", lines: ["Only MX Patrol platform owners or system operators can manage Kiosk Mode."], options: [{ id: "secure_devices", label: "Secure Device Menu" }] } };
  }

  if (session.current_step === "WAITING_FOR_DEVICE") {
    const choices = (data.device_choices ?? []) as Array<Record<string, any>>;
    const device = pickChoice(input, choices, (row) => String(row.device_identifier ?? row.device_name ?? ""));
    if (!device) {
      return { session, message: { title: "SELECT DEVICE", lines: ["I did not catch that device."], options: choices.map((row) => ({ id: String(row.device_identifier), label: formatSecureDeviceLabel(row) })) } };
    }
    data.device_identifier = device.device_identifier;
    const step = action === "request_maintenance_mode" ? "WAITING_FOR_DURATION" : "WAITING_FOR_CONFIRM";
    const next = await patchSession(client, session, { current_step: step, temporary_data: data });
    return await secureDeviceAction(client, identity, next, "summary");
  }

  if (session.current_step === "WAITING_FOR_DURATION") {
    if (input.trim().toLowerCase() !== "summary") {
      const minutes = Number(input.trim());
      if (![10, 20, 30, 60].includes(minutes)) {
        return { session, message: { title: "MAINTENANCE DURATION", lines: ["Choose how long maintenance mode should remain active."], options: [10, 20, 30, 60].map((value) => ({ id: String(value), label: value + " minutes" })) } };
      }
      data.duration_minutes = minutes;
      data.expires_at = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    }
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return await secureDeviceAction(client, identity, next, "summary");
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (input.trim().toLowerCase() === "summary") {
      const lines = [
        "Device: " + data.device_identifier,
        "Action: " + (SECURE_ACTION_LABELS[action] ?? action),
        action === "request_maintenance_mode" ? "Duration: " + (data.duration_minutes ?? 10) + " minutes" : null,
        isKioskSecureAction(action) ? "Kiosk Status changes only after the physical patrol device acknowledges the policy." : null,
        "This will queue a secure remote command and record an audit event.",
      ].filter(Boolean) as string[];
      return { session, message: { title: "CONFIRM SECURE COMMAND", lines, options: [{ id: "1", label: "Confirm" }, { id: "2", label: "Cancel" }] } };
    }
    if (!/^(1|confirm|yes|y)$/i.test(input.trim())) {
      return { session: await clearFlow(client, session), message: CANCELLED };
    }
    try {
      const payload = action === "request_maintenance_mode" ? { duration_minutes: data.duration_minutes ?? 10, expires_at: data.expires_at } : {};
      const result = await requestSecureDeviceCommand(client, identity, session.current_site_id, action, String(data.device_identifier), payload, "whatsapp");
      return {
        session: await clearFlow(client, session),
        message: {
          title: "SECURE COMMAND QUEUED",
          lines: [
            "Device: " + String(result.device.device_identifier ?? data.device_identifier),
            "Action: " + (SECURE_ACTION_LABELS[action] ?? action),
            "Command status: " + String(result.command_status ?? result.command?.status ?? "pending"),
          ],
          options: [{ id: "secure_devices", label: "Secure Device Menu" }, { id: "menu", label: "Main Menu" }],
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Secure command failed";
      return { session: await clearFlow(client, session), message: { title: "SECURE COMMAND FAILED", lines: [message], options: [{ id: "secure_devices", label: "Secure Device Menu" }] } };
    }
  }

  return { session: await clearFlow(client, session), message: CANCELLED };
}