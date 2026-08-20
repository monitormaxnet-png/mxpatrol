import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import type { Identity, OutMessage, SessionRow, SiteRow } from "./types.ts";
import { allowedSites } from "./identity.ts";
import { clearFlow, patchSession } from "./session.ts";

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
    default:
      return { session: await clearFlow(client, session), message: CANCELLED };
  }
}

/* ------------------------------ register device ---------------------------- */

async function registerDevice(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  input: string,
): Promise<FlowResult> {
  const data = { ...(session.temporary_data ?? {}) } as Record<string, any>;

  if (session.current_step === "WAITING_FOR_NAME") {
    data.device_name = input.trim().slice(0, 80);
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
        title: "ENROLLMENT CODE",
        lines: ["Open MX Patrol on the device and send me the enrollment code it shows.", "", "Example: MX-7K3P92"],
        footer: "Type *cancel* to stop.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CODE") {
    const code = input.trim().toUpperCase().replace(/^MXP?-?/, "").replace(/[\s-]/g, "");
    const { data: devices } = await client
      .from("devices")
      .select("id, device_identifier, device_name, pairing_status, pairing_expires_at, company_id")
      .eq("company_id", identity.company_id)
      .eq("pairing_code", code)
      .limit(1);
    const device = (devices ?? [])[0] as any;

    if (!device) {
      return {
        session,
        message: {
          title: "CODE NOT RECOGNISED",
          lines: [`I couldn't find a device with the code ${code}.`, "Check the code on the device and send it again."],
          footer: "Type *cancel* to stop.",
        },
      };
    }
    if (device.pairing_status === "paired" || device.pairing_status === "active") {
      return {
        session: await clearFlow(client, session),
        message: {
          title: "ALREADY REGISTERED",
          lines: [`${device.device_identifier} is already registered.`],
          options: [{ id: "menu", label: "Main Menu" }],
        },
      };
    }

    data.device_id = device.id;
    data.device_identifier = device.device_identifier;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
    return {
      session: next,
      message: {
        title: "CONFIRM DEVICE",
        lines: [`Name: ${data.device_name}`, `Device: ${device.device_identifier}`, `Site: ${data.site_name}`],
        options: [{ id: "confirm", label: "Confirm" }, { id: "cancel", label: "Cancel" }],
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (!/^(1|confirm|yes|y)$/i.test(input.trim())) {
      return { session: await clearFlow(client, session), message: CANCELLED };
    }
    const { error } = await client
      .from("devices")
      .update({
        device_name: data.device_name,
        site_id: data.site_id,
        pairing_status: "paired",
        pairing_code: null,
        pairing_expires_at: null,
      })
      .eq("id", data.device_id)
      .eq("company_id", identity.company_id);

    if (error) {
      console.error("[WA] device register failed:", error.message);
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT REGISTER", lines: [error.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    return {
      session: await clearFlow(client, session),
      message: {
        title: "✅ DEVICE REGISTERED",
        lines: [`${data.device_name} is now registered to ${data.site_name}.`],
        options: [{ id: "devices", label: "View Devices" }, { id: "menu", label: "Main Menu" }],
      },
    };
  }

  return { session: await clearFlow(client, session), message: CANCELLED };
}

/* ------------------------------ add checkpoint ----------------------------- */

async function createCheckpoint(
  client: SupabaseClient,
  identity: Identity,
  session: SessionRow,
  input: string,
): Promise<FlowResult> {
  const data = { ...(session.temporary_data ?? {}) } as Record<string, any>;

  if (session.current_step === "WAITING_FOR_NAME") {
    data.checkpoint_name = input.trim().slice(0, 80);
    const sites = await allowedSites(client, identity);
    data.site_choices = sites;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_SITE", temporary_data: data });
    return {
      session: next,
      message: {
        title: "SELECT SITE",
        lines: [`Which site should “${data.checkpoint_name}” belong to?`],
        options: siteOptions(sites),
      },
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

    await client
      .from("whatsapp_nfc_capture_requests")
      .update({ status: "cancelled" })
      .eq("phone", identity.phone)
      .eq("status", "waiting");

    const { data: request, error } = await client
      .from("whatsapp_nfc_capture_requests")
      .insert({
        company_id: identity.company_id,
        site_id: site.id,
        session_id: session.id,
        phone: identity.phone,
        requested_by: identity.user_id,
        purpose: "create_checkpoint",
        checkpoint_name: data.checkpoint_name,
        status: "waiting",
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[WA] nfc capture request failed:", error.message);
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT START", lines: [error.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    data.capture_request_id = request?.id;
    const next = await patchSession(client, session, { current_step: "WAITING_FOR_NFC", temporary_data: data });
    return {
      session: next,
      message: {
        title: "WAITING FOR NFC SCAN…",
        lines: [
          "Now use an enrolled MX Patrol device to scan the NFC tag you want to use for:",
          "",
          `*${data.checkpoint_name}* — ${site.name}`,
          "",
          "I'll message you as soon as the tag is detected.",
        ],
        footer: "Type *cancel* to stop.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_NFC") {
    const { data: request } = await client
      .from("whatsapp_nfc_capture_requests")
      .select("id, status, nfc_tag_id, device_identifier")
      .eq("id", data.capture_request_id)
      .maybeSingle();

    if (request?.status === "captured" && request.nfc_tag_id) {
      data.nfc_tag_id = request.nfc_tag_id;
      const next = await patchSession(client, session, { current_step: "WAITING_FOR_CONFIRM", temporary_data: data });
      if (/^(1|confirm|yes|create|create checkpoint)$/i.test(input.trim())) {
        return await createCheckpoint(client, identity, next, input);
      }
      return {
        session: next,
        message: {
          title: "✅ NFC TAG DETECTED",
          lines: [
            `Checkpoint: ${data.checkpoint_name}`,
            `Site: ${data.site_name}`,
            `Device used: ${request.device_identifier ?? "Unknown"}`,
          ],
          options: [{ id: "confirm", label: "Create Checkpoint" }, { id: "cancel", label: "Cancel" }],
        },
      };
    }

    return {
      session,
      message: {
        title: "STILL WAITING",
        lines: ["No tag has been scanned yet. Tap the NFC tag with an enrolled MX Patrol device."],
        footer: "Type *cancel* to stop.",
      },
    };
  }

  if (session.current_step === "WAITING_FOR_CONFIRM") {
    if (!/^(1|confirm|yes|y|create)/i.test(input.trim())) {
      await client.from("whatsapp_nfc_capture_requests").update({ status: "cancelled" }).eq("id", data.capture_request_id);
      return { session: await clearFlow(client, session), message: CANCELLED };
    }

    const { error } = await client.from("checkpoints").insert({
      company_id: identity.company_id,
      site_id: data.site_id,
      name: data.checkpoint_name,
      nfc_tag_id: data.nfc_tag_id,
    });

    if (error) {
      console.error("[WA] checkpoint insert failed:", error.message);
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT CREATE", lines: [error.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    await client.from("whatsapp_nfc_capture_requests").update({ status: "completed" }).eq("id", data.capture_request_id);

    return {
      session: await clearFlow(client, session),
      message: {
        title: `✅ ${data.checkpoint_name} created`,
        lines: [`The checkpoint is now active at ${data.site_name}.`],
        options: [{ id: "setup", label: "Setup" }, { id: "menu", label: "Main Menu" }],
      },
    };
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

    const { data: route, error: routeError } = await client
      .from("patrol_routes")
      .insert({
        company_id: identity.company_id,
        site_id: data.site_id,
        name: data.patrol_name,
        description: "Created from WhatsApp",
        status: "active",
        created_by: identity.user_id,
      })
      .select("id")
      .maybeSingle();

    if (routeError || !route) {
      console.error("[WA] route insert failed:", routeError?.message);
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT CREATE", lines: [routeError?.message ?? "Route creation failed."], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    const checkpointRows = (data.checkpoint_ids as string[]).map((checkpointId, index) => ({
      company_id: identity.company_id,
      route_id: route.id,
      checkpoint_id: checkpointId,
      sequence_order: index + 1,
      is_required: true,
    }));

    const { error: checkpointError } = await client.from("patrol_route_checkpoints").insert(checkpointRows);
    if (checkpointError) {
      await client.from("patrol_routes").delete().eq("id", route.id);
      console.error("[WA] route checkpoints insert failed:", checkpointError.message);
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT CREATE", lines: [checkpointError.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    const [hours, minutes] = String(data.start_time).split(":").map(Number);
    const nextRun = new Date();
    nextRun.setHours(hours, minutes, 0, 0);
    if (nextRun.getTime() < Date.now()) nextRun.setDate(nextRun.getDate() + 1);

    const { error: scheduleError } = await client.from("patrol_schedules").insert({
      company_id: identity.company_id,
      site_id: data.site_id,
      route_id: route.id,
      name: data.patrol_name,
      frequency: data.frequency,
      frequency_type: data.frequency,
      interval_value: 1,
      start_time: data.start_time,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      timezone: "Africa/Johannesburg",
      status: "active",
      next_run_at: nextRun.toISOString(),
      active_from: new Date().toISOString(),
      grace_start_minutes: 10,
      grace_completion_minutes: 30,
      expected_duration_minutes: Math.max((data.checkpoint_ids as string[]).length * 8, 20),
      created_by: identity.user_id,
      description: "Created from WhatsApp",
    });

    if (scheduleError) {
      console.error("[WA] schedule insert failed:", scheduleError.message);
      return {
        session: await clearFlow(client, session),
        message: {
          title: "PATROL SAVED, SCHEDULE FAILED",
          lines: [`The route was created but the schedule could not be saved: ${scheduleError.message}`],
          options: [{ id: "menu", label: "Main Menu" }],
        },
      };
    }

    return {
      session: await clearFlow(client, session),
      message: {
        title: "✅ PATROL CREATED",
        lines: [
          `${data.patrol_name} — ${data.site_name}`,
          `${(data.checkpoint_ids as string[]).length} checkpoints`,
          `${data.frequency_label} at ${data.start_time}`,
        ],
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
    const { data: incident, error } = await client
      .from("incidents")
      .insert({
        company_id: identity.company_id,
        site_id: data.site_id,
        guard_id: identity.guard_id,
        title: String(data.description).slice(0, 80),
        description: data.description,
        severity: data.severity,
        image_url: media[0] ?? null,
        ai_classification: "whatsapp_report",
        ai_suggested_action: "Review and dispatch supervisor",
        event_occurred_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[WA] incident insert failed:", error.message);
      return {
        session: await clearFlow(client, session),
        message: { title: "COULD NOT SUBMIT", lines: [error.message], options: [{ id: "menu", label: "Main Menu" }] },
      };
    }

    return {
      session: await clearFlow(client, session),
      message: {
        title: "✅ INCIDENT CREATED",
        lines: [`Reference: INC-${String(incident?.id ?? "").slice(0, 6).toUpperCase()}`, `${data.site_name} · ${data.severity_label}`],
        options: [{ id: "incidents", label: "View Incidents" }, { id: "menu", label: "Main Menu" }],
      },
    };
  }

  return { session: await clearFlow(client, session), message: CANCELLED };
}
