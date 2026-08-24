// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import type { Identity, OutMessage, SessionRow, SiteRow } from "./types.ts";
import { allowedSites } from "./identity.ts";
import { clearFlow, patchSession } from "./session.ts";
import { formatSecureDeviceLabel, getSecureDeviceRows, requestSecureDeviceCommand, type SecureDeviceAction } from "../../_shared/secure-device-management.ts";
import { ManagementActionError, runManagementAction, type ManagementActor, type ManagementResult } from "../../_shared/management-actions.ts";

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
  { id: "1", label: "No form" },
  { id: "2", label: "Use existing form" },
  { id: "3", label: "Create checklist" },
  { id: "4", label: "Create data-entry form" },
  { id: "5", label: "Create checklist + data form" },
];

const CHECKLIST_FIELDS = [
  { label: "Door locked?", field_type: "yes_no", required: true, sequence_order: 1 },
  { label: "Fire extinguisher present?", field_type: "yes_no", required: true, sequence_order: 2 },
  { label: "Lights working?", field_type: "yes_no", required: true, sequence_order: 3 },
  { label: "Area clear?", field_type: "pass_fail", required: true, sequence_order: 4 },
  { label: "Any damage observed?", field_type: "pass_fail", required: true, sequence_order: 5 },
];

const DATA_ENTRY_FIELDS = [
  { label: "Notes", field_type: "long_text", required: false, sequence_order: 1 },
  { label: "Photo", field_type: "photo", required: false, sequence_order: 2 },
  { label: "Meter Reading", field_type: "meter_reading", required: false, sequence_order: 3 },
];

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
    if (/^(1|no|none|no form)$/i.test(choice)) {
      data.data_log_choice = "none";
      data.data_log_form_id = null;
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
      return await createCheckpoint(client, identity, next, "summary");
    }

    if (/^(2|existing|use existing)/i.test(choice)) {
      const { data: forms, error } = await client.from("data_log_forms").select("id, name, form_type, data_log_form_fields(id)").eq("company_id", identity.company_id).eq("is_active", true).or("site_id.is.null,site_id.eq." + data.site_id).order("name", { ascending: true }).limit(9);
      if (error) return { session, message: { title: "FORM LOOKUP FAILED", lines: [error.message], options: DATA_LOG_OPTIONS } };
      if (!forms?.length) return { session, message: { title: "NO FORMS FOUND", lines: ["No reusable Data Log Forms are available for this site yet."], options: DATA_LOG_OPTIONS } };
      data.form_choices = forms;
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_EXISTING_FORM", temporary_data: data });
      return { session: next, message: { title: "SELECT DATA LOG FORM", lines: forms.map((form: any, index: number) => String(index + 1) + ". " + form.name), footer: "Reply with the form number, or cancel." } };
    }

    const checkpointName = String(data.checkpoint_name ?? "Checkpoint");
    if (/^(3|checklist|create checklist)/i.test(choice)) {
      data.data_log_choice = "new";
      data.pending_form = { name: checkpointName + " Inspection", form_type: "checklist", fields: CHECKLIST_FIELDS };
    } else if (/^(4|data|data-entry|entry)/i.test(choice)) {
      data.data_log_choice = "new";
      data.pending_form = { name: checkpointName + " Data Log", form_type: "data_entry", fields: DATA_ENTRY_FIELDS };
    } else if (/^(5|mixed|both|checklist.*data)/i.test(choice)) {
      data.data_log_choice = "new";
      data.pending_form = { name: checkpointName + " Inspection", form_type: "mixed", fields: [...CHECKLIST_FIELDS, ...DATA_ENTRY_FIELDS.map((field, index) => ({ ...field, sequence_order: CHECKLIST_FIELDS.length + index + 1 }))] };
    } else {
      return { session, message: { title: "DATA LOG FORM", lines: ["Choose how data should be collected."], options: DATA_LOG_OPTIONS } };
    }

    data.data_log_form_name = data.pending_form.name;
    data.data_log_form_type = data.pending_form.form_type;
    data.data_log_field_count = data.pending_form.fields.length;
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
    data.data_log_field_count = Array.isArray(form.data_log_form_fields) ? form.data_log_form_fields.length : 0;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return await createCheckpoint(client, identity, next, "summary");
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (input.trim().toLowerCase() === "summary") {
      return {
        session,
        message: {
          title: "6/6 - CONFIRM REGISTRATION",
          lines: [
            "Name: " + data.checkpoint_name,
            "Zone: " + data.location_note,
            "Site: " + data.site_name,
            "NFC: Assigned",
            "Data Log Form: " + dataLogOptionSummary(data),
            data.data_log_field_count != null ? "Fields: " + data.data_log_field_count : null,
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
      data_log_form_id: data.data_log_form_id ?? null,
      new_form: data.pending_form ?? null,
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

const FREQUENCIES = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays only" },
  { id: "hourly", label: "Every hour" },
  { id: "once", label: "Once" },
];

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
    return { session: next, message: { title: "CREATE PATROL", lines: ["Which site?"], options: siteOptions(sites) } };
  }

  if (session.current_step === "WAITING_FOR_SITE") {
    const sites = (data.site_choices ?? []) as SiteRow[];
    const site = pickChoice(input, sites, (s) => s.name);
    if (!site) {
      return { session, message: { title: "SELECT SITE", lines: ["I didn't catch that site."], options: siteOptions(sites) } };
    }
    data.site_id = site.id;
    data.site_name = site.name;

    const { data: checkpoints } = await client
      .from("checkpoints")
      .select("id, name")
      .eq("company_id", identity.company_id)
      .eq("site_id", site.id)
      .order("name")
      .limit(20);

    if (!checkpoints?.length) {
      return {
        session: await clearFlow(client, session),
        message: {
          title: "NO CHECKPOINTS",
          lines: [`${site.name} has no checkpoints yet. Add a checkpoint first.`],
          options: [{ id: "add_checkpoint", label: "Add Checkpoint" }, { id: "menu", label: "Main Menu" }],
        },
      };
    }

    data.checkpoint_choices = checkpoints;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CHECKPOINTS", temporary_data: data });
    return {
      session: next,
      message: {
        title: "CHECKPOINTS",
        lines: [
          "Which checkpoints should be included?",
          "",
          checkpoints.map((c: any, i: number) => `${i + 1}. ${c.name}`).join("\n"),
        ],
        footer: "Reply with numbers, e.g. 1,2,4 — or *all*.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CHECKPOINTS") {
    const checkpoints = (data.checkpoint_choices ?? []) as Array<{ id: string; name: string }>;
    const trimmed = input.trim().toLowerCase();
    let selected: Array<{ id: string; name: string }> = [];

    if (trimmed === "all") {
      selected = checkpoints;
    } else {
      const indexes = trimmed.split(/[,\s]+/).map((part) => Number(part)).filter((n) => Number.isInteger(n));
      selected = indexes
        .filter((n) => n >= 1 && n <= checkpoints.length)
        .map((n) => checkpoints[n - 1]);
    }

    if (!selected.length) {
      return {
        session,
        message: {
          title: "CHECKPOINTS",
          lines: ["I didn't catch that. Reply with numbers, e.g. 1,2,4 — or *all*."],
          footer: checkpoints.map((c, i) => `${i + 1}. ${c.name}`).join("\n"),
        },
      };
    }

    data.checkpoint_ids = selected.map((c) => c.id);
    data.checkpoint_names = selected.map((c) => c.name);
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_FREQUENCY", temporary_data: data });
    return {
      session: next,
      message: { title: "SCHEDULE", lines: ["How often should this patrol run?"], options: FREQUENCIES.map((f) => ({ id: f.id, label: f.label })) },
    };
  }

  if (session.current_step === "WAITING_FOR_FREQUENCY") {
    const frequency = pickChoice(input, FREQUENCIES, (f) => f.label);
    if (!frequency) {
      return { session, message: { title: "SCHEDULE", lines: ["Choose how often it runs."], options: FREQUENCIES.map((f) => ({ id: f.id, label: f.label })) } };
    }
    data.frequency = frequency.id;
    data.frequency_label = frequency.label;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_TIME", temporary_data: data });
    return {
      session: next,
      message: { title: "START TIME", lines: ["What time should it start? Use 24-hour format, e.g. 22:00"], footer: "Type *cancel* to stop." },
    };
  }

  if (session.current_step === "WAITING_FOR_TIME") {
    const match = input.trim().match(/^(\d{1,2})[:h.]?(\d{2})?$/);
    if (!match) {
      return { session, message: { title: "START TIME", lines: ["Please send a time like 22:00."], footer: "Type *cancel* to stop." } };
    }
    const hours = Math.min(Number(match[1]), 23).toString().padStart(2, "0");
    const minutes = Math.min(Number(match[2] ?? "0"), 59).toString().padStart(2, "0");
    data.start_time = `${hours}:${minutes}`;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return {
      session: next,
      message: {
        title: data.patrol_name,
        lines: [
          data.site_name,
          `${(data.checkpoint_ids as string[]).length} checkpoints`,
          `${data.frequency_label} at ${data.start_time}`,
        ],
        options: [{ id: "confirm", label: "Create Patrol" }, { id: "cancel", label: "Cancel" }],
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (!/^(1|confirm|yes|y|create)/i.test(input.trim())) {
      return { session: await clearFlow(client, session), message: CANCELLED };
    }

    const routeOutcome = await callManagement(client, identity, "create_route", {
      site_id: data.site_id,
      name: data.patrol_name,
      checkpoint_ids: data.checkpoint_ids,
      enforce_sequence: Boolean(data.enforce_sequence),
    });

    if (!routeOutcome.result) {
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT CREATE", lines: [routeOutcome.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    const routeId = String((routeOutcome.result.record as Record<string, any>).id);
    const scheduleOutcome = await callManagement(client, identity, "create_schedule", {
      site_id: data.site_id,
      route_id: routeId,
      name: data.patrol_name,
      frequency: data.frequency,
      start_time: data.start_time,
      expected_duration_minutes: Math.max((data.checkpoint_ids as string[]).length * 8, 20),
    });

    if (!scheduleOutcome.result) {
      return {
        session: await clearFlow(client, session),
        message: {
          title: "PATROL SAVED, SCHEDULE FAILED",
          lines: [`The route was created but the schedule could not be saved: ${scheduleOutcome.message}`],
          options: [{ id: "menu", label: "Main Menu" }],
        },
      };
    }

    return {
      session: await clearFlow(client, session),
      message: {
        title: "✅ PATROL CREATED",
        lines: [routeOutcome.result.summary, scheduleOutcome.result.summary],
        options: [{ id: "live", label: "Live Now" }, { id: "menu", label: "Main Menu" }],
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
  request_app_update: "Require App Update",
  request_integrity_check: "Run Security Check",
  revoke_device: "Revoke Device",
};

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
            result.queued ? "Status: queued for device pickup" : "Status: sent to online device",
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