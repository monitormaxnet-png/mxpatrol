import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { normalizePhone, type Identity, type OutMessage, type SessionRow, type SiteRow } from "./lib/types.ts";
import { emptyTwiml, parseInboundWhatsAppRequest, type InboundWhatsAppMessage } from "./lib/request.ts";
import { allowedSites, resolveIdentity } from "./lib/identity.ts";
import { clearFlow, loadSession, patchSession } from "./lib/session.ts";
import { renderText, sendLocation, twiml } from "./lib/render.ts";
import { classifyIntent, keywordIntent, type Intent } from "./lib/askmx.ts";
import { handleFlowInput, startFlow, startSecureDeviceAction } from "./lib/flows.ts";
import { runManagementAction, type ManagementActor } from "../_shared/management-actions.ts";
import {
  activePatrols,
  attention,
  deviceDetail,
  deviceList,
  incidentsView,
  liveNow,
  mainMenu,
  managementMenu,
  checkpointsView,
  patrolStatusView,
  patrolStatusOverview,
  missedCheckpointsView,
  reportPeriodMenu,
  reportSummary,
  setupMenu,
  secureDeviceInfo,
  secureDeviceList,
  secureDeviceMenu,
  secureDeviceProblems,
  secureDeviceStatus,
  MANAGEMENT_HOME_KEY,
  WA_SUBMENUS,
  backTarget,
  resolveMenuChoice,
} from "./lib/views.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOCKOUT: OutMessage = {
  title: "ðŸ” MX Patrol account required",
  lines: [
    "This WhatsApp number isn't linked to an MX Patrol account.",
    "",
    "Ask a manager to open WhatsApp Management and create a link code for your number.",
    "Then send that code here from this same WhatsApp number. Example: MX-WA-482731",
  ],
  footer: "",
};

type Ctx = {
  client: ReturnType<typeof createClient>;
  identity: Identity;
  session: SessionRow;
};

function optionMenu(title: string, lines: string[], options: Array<{ id: string; label: string }>): OutMessage {
  return { title, lines, options };
}

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

function siteChooser(sites: SiteRow[]): OutMessage {
  const options = sites.slice(0, 9).map((site) => ({ id: `site:${site.id}`, label: site.name }));
  return optionMenu("WHICH SITE?", ["Choose the site you want to work with."], options);
}

async function respondWith(ctx: Ctx, message: OutMessage): Promise<string> {
  await patchSession(ctx.client, ctx.session, {
    temporary_data: {
      ...(ctx.session.temporary_data ?? {}),
      last_options: message.options ?? [],
      last_menu_key: message.menuKey ?? (ctx.session.temporary_data?.["last_menu_key"] ?? null),
    },
  });

  await recordMessages(ctx, message);
  return renderText(message);
}

async function ensureConversation(ctx: Ctx): Promise<{ id: string } | null> {
  let { data: conversation } = await ctx.client
    .from("whatsapp_conversations")
    .select("id")
    .eq("phone_number", ctx.identity.phone)
    .eq("company_id", ctx.identity.company_id)
    .maybeSingle();

  if (!conversation) {
    const { data: created, error } = await ctx.client
      .from("whatsapp_conversations")
      .insert({
        phone_number: ctx.identity.phone,
        company_id: ctx.identity.company_id,
        guard_id: ctx.identity.guard_id,
        is_active: true,
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    conversation = created;
  }

  return conversation;
}

async function recordMessages(ctx: Ctx, message: OutMessage) {
  try {
    const conversation = await ensureConversation(ctx);
    if (!conversation) return;

    await ctx.client.from("whatsapp_messages").insert({
      conversation_id: conversation.id,
      company_id: ctx.identity.company_id,
      direction: "outbound",
      message_body: renderText(message),
      message_type: "system",
    });
    await ctx.client.from("whatsapp_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);
  } catch (error) {
    console.warn("[WA] message logging failed:", error);
  }
}

async function hasDuplicateInbound(ctx: Ctx, messageSid: string | null): Promise<boolean> {
  if (!messageSid) return false;
  const { data, error } = await ctx.client
    .from("whatsapp_messages")
    .select("id")
    .eq("company_id", ctx.identity.company_id)
    .eq("direction", "inbound")
    .eq("twilio_sid", messageSid)
    .limit(1);
  if (error) {
    console.warn("[WA] duplicate check failed:", error.message);
    return false;
  }
  return Boolean(data?.length);
}

async function storeInbound(ctx: Ctx, inbound: InboundWhatsAppMessage) {
  try {
    const conversation = await ensureConversation(ctx);
    if (!conversation) return;
    await ctx.client.from("whatsapp_messages").insert({
      conversation_id: conversation.id,
      company_id: ctx.identity.company_id,
      direction: "inbound",
      message_body: inbound.body || (inbound.mediaUrls.length ? "[media]" : ""),
      message_type: "text",
      twilio_sid: inbound.messageSid,
      metadata: {
        to: inbound.to || null,
        account_sid: inbound.accountSid,
        profile_name: inbound.profileName,
        wa_id: inbound.waId,
        media_count: inbound.mediaUrls.length,
      },
    });
  } catch (error) {
    console.warn("[WA] inbound logging failed:", error);
  }
}

/** Site context resolution: auto-select single site, remember choice, ask when ambiguous. */
async function ensureSiteContext(ctx: Ctx): Promise<{ siteId: string | null; ask?: OutMessage }> {
  if (ctx.session.current_site_id) return { siteId: ctx.session.current_site_id };

  const sites = await allowedSites(ctx.client, ctx.identity);
  if (sites.length === 0) return { siteId: null };
  if (sites.length === 1) {
    ctx.session = await patchSession(ctx.client, ctx.session, {
      current_site_id: sites[0].id,
      current_site_name: sites[0].name,
      site_scope: "single",
    });
    return { siteId: sites[0].id };
  }
  return { siteId: null, ask: siteChooser(sites) };
}

async function runIntent(ctx: Ctx, intent: Intent): Promise<OutMessage> {
  switch (intent.action) {
    case "menu":
      if (ctx.session.last_menu === "management" && ctx.identity.canManage) {
        return managementMenu(ctx.identity, ctx.session);
      }
      ctx.session = await patchSession(ctx.client, ctx.session, { last_menu: "user" });
      return mainMenu(ctx.identity, ctx.session);

    case "user":
      ctx.session = await patchSession(ctx.client, ctx.session, { last_menu: "user" });
      return mainMenu(ctx.identity, ctx.session);

    case "management":
      ctx.session = await patchSession(ctx.client, ctx.session, { last_menu: ctx.identity.canManage ? "management" : "user" });
      return managementMenu(ctx.identity, ctx.session);

    case "whatsapp_management":
      if (!ctx.identity.canManage) {
        return optionMenu("MANAGEMENT ACCESS UNAVAILABLE", ["Your account does not have permission to use management actions."], [{ id: "menu", label: "Main Menu" }]);
      }
      ctx.session = await patchSession(ctx.client, ctx.session, { last_menu: "management" });
      return WA_SUBMENUS.management_whatsapp;

    case "change_site": {
      const sites = await allowedSites(ctx.client, ctx.identity);
      ctx.session = await patchSession(ctx.client, ctx.session, {
        current_site_id: null,
        current_site_name: null,
        site_scope: "single",
      });
      return siteChooser(sites);
    }

    case "live": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await liveNow(ctx.client, ctx.identity, siteId);
    }

    case "patrols": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await activePatrols(ctx.client, ctx.identity, siteId);
    }

    case "attention": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await attention(ctx.client, ctx.identity, intent.filter ?? "all", siteId);
    }

    case "devices": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      const message = await deviceList(ctx.client, ctx.identity, siteId);
      if (intent.filter === "offline") {
        message.options = (message.options ?? []).filter((option) => option.label.includes("Offline"));
        message.lines = message.options.length ? message.lines : ["ðŸŸ¢ All devices are online."];
      }
      return message;
    }

    case "device_detail": {
      const { message, gps } = await deviceDetail(ctx.client, ctx.identity, intent.device);
      if (gps) await sendLocation(ctx.identity.phone, gps.lat, gps.lng, gps.label);
      return message;
    }

    case "incidents": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await incidentsView(ctx.client, ctx.identity, siteId);
    }

    case "reports": {
      if (!intent.period) return reportPeriodMenu();
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await reportSummary(ctx.client, ctx.identity, siteId, intent.period, intent.problems_only ?? false);
    }

    case "completed_patrols":
    case "incomplete_patrols":
    case "late_patrols":
    case "missed_patrols": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      const group = intent.action === "completed_patrols" ? "completed" : intent.action === "incomplete_patrols" ? "incomplete" : intent.action === "late_patrols" ? "late" : "missed";
      return await patrolStatusView(ctx.client, ctx.identity, siteId, group);
    }

    case "missed_checkpoints": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await missedCheckpointsView(ctx.client, ctx.identity, siteId);
    }

    case "patrol_status": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await patrolStatusOverview(ctx.client, ctx.identity, siteId, ctx.session.current_site_name);
    }


    case "checkpoints": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await checkpointsView(ctx.client, ctx.identity, siteId);
    }


    case "secure_devices": {
      ctx.session = await patchSession(ctx.client, ctx.session, { last_menu: "management" });
      const { ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return secureDeviceMenu(ctx.identity, ctx.session);
    }

    case "secure_device_status": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await secureDeviceStatus(ctx.client, ctx.identity, siteId);
    }

    case "secure_device_problems": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      return await secureDeviceProblems(ctx.client, ctx.identity, siteId);
    }

    case "secure_device_detail": {
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      if (!intent.device) return await secureDeviceList(ctx.client, ctx.identity, siteId);
      return await secureDeviceInfo(ctx.client, ctx.identity, siteId, intent.device);
    }

    case "secure_device_action": {
      if (!ctx.identity.canManage) {
        return optionMenu("MANAGEMENT ACCESS UNAVAILABLE", ["Your account does not have permission to use management actions."], [{ id: "menu", label: "Main Menu" }]);
      }
      const { ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      const result = await startSecureDeviceAction(ctx.client, ctx.identity, ctx.session, intent.secureAction as any, intent.device ?? null);
      ctx.session = result.session;
      return result.message;
    }

    case "view_whatsapp_numbers": {
      if (!ctx.identity.canManage) {
        return optionMenu("MANAGEMENT ACCESS UNAVAILABLE", ["Your account does not have permission to use management actions."], [{ id: "menu", label: "Main Menu" }]);
      }
      const { siteId, ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      const result = await runManagementAction(ctx.client, managementActor(ctx.identity), "list_whatsapp_authorizations", { site_id: siteId });
      const rows = ((result.record.rows ?? []) as Array<Record<string, unknown>>);
      return optionMenu("WHATSAPP AUTHORIZED NUMBERS", rows.length ? rows.map((row, index) => String(index + 1) + ". " + String(row.display_name ?? "Unknown") + " - " + String(row.masked_phone ?? row.phone ?? "Not linked") + " (" + String(row.status ?? "unknown") + ")" + (row.link_code ? " - code " + String(row.link_code) : "")) : ["No WhatsApp numbers are authorized for this site yet."], [{ id: "management_whatsapp", label: "WhatsApp Management" }, { id: "menu", label: "Main Menu" }]);
    }
    case "setup":
      if (!ctx.identity.canSetup) {
        return optionMenu("NOT ALLOWED", ["Only company administrators can change setup."], [{ id: "menu", label: "Main Menu" }]);
      }
      return setupMenu();

    case "register_device":
    case "add_checkpoint":
    case "create_patrol":
    case "report_incident":
    case "authorize_whatsapp":
    case "revoke_whatsapp_access": {
      if (!ctx.identity.canManage) {
        return optionMenu("MANAGEMENT ACCESS UNAVAILABLE", ["Your account does not have permission to use management actions."], [{ id: "menu", label: "Main Menu" }]);
      }
      const { ask } = await ensureSiteContext(ctx);
      if (ask) return ask;
      const flow = intent.action === "register_device"
        ? "REGISTER_DEVICE"
        : intent.action === "add_checkpoint"
          ? "CREATE_CHECKPOINT"
          : intent.action === "create_patrol"
            ? "CREATE_PATROL"
            : intent.action === "authorize_whatsapp"
              ? "AUTHORIZE_WHATSAPP"
              : intent.action === "revoke_whatsapp_access"
                ? "REVOKE_WHATSAPP"
                : "REPORT_INCIDENT";
      const result = await startFlow(ctx.client, ctx.identity, ctx.session, flow as any);
      ctx.session = result.session;
      return result.message;
    }

    default:
      return {
        title: "MX PATROL",
        lines: [
          intent.action === "unknown" && intent.reply
            ? intent.reply
            : "I didn't understand that.",
        ],
        options: (mainMenu(ctx.identity, ctx.session).options ?? []),
      };
  }
}

/** Handles the ids that only exist as menu selections (site:, device:, ack, problems, periods). */
async function runSelection(ctx: Ctx, id: string): Promise<OutMessage | null> {
  if (WA_SUBMENUS[id]) {
    if (!ctx.identity.canManage) {
      return optionMenu("MANAGEMENT ACCESS UNAVAILABLE", ["Your account does not have permission to use management actions."], [{ id: "menu", label: "User Assistant" }]);
    }
    ctx.session = await patchSession(ctx.client, ctx.session, { last_menu: "management" });
    return WA_SUBMENUS[id];
  }

  if (id === "back") {
    const target = backTarget(ctx.session);
    if (WA_SUBMENUS[target]) return WA_SUBMENUS[target];
    if (target === MANAGEMENT_HOME_KEY && ctx.identity.canManage) return managementMenu(ctx.identity, ctx.session);
    ctx.session = await patchSession(ctx.client, ctx.session, { last_menu: "user" });
    return mainMenu(ctx.identity, ctx.session);
  }

  if (id.startsWith("site:")) {
    const value = id.slice(5);
    const sites = await allowedSites(ctx.client, ctx.identity);
    const site = sites.find((item: SiteRow) => item.id === value);
    if (!site) return null;
    ctx.session = await patchSession(ctx.client, ctx.session, {
      current_site_id: site.id,
      current_site_name: site.name,
      site_scope: "single",
    });
    return await liveNow(ctx.client, ctx.identity, site.id);
  }

  if (id.startsWith("device:")) {
    const { message, gps } = await deviceDetail(ctx.client, ctx.identity, id.slice(7));
    if (gps) await sendLocation(ctx.identity.phone, gps.lat, gps.lng, gps.label);
    return message;
  }

  if (id.startsWith("location:")) {
    const { message, gps } = await deviceDetail(ctx.client, ctx.identity, id.slice(9));
    if (gps) await sendLocation(ctx.identity.phone, gps.lat, gps.lng, gps.label);
    return message;
  }


  if (id === "secure_devices") {
    const { ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    return secureDeviceMenu(ctx.identity, ctx.session);
  }

  if (id === "secure_device_status") {
    const { siteId, ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    return await secureDeviceStatus(ctx.client, ctx.identity, siteId);
  }

  if (id === "secure_device_problems") {
    const { siteId, ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    return await secureDeviceProblems(ctx.client, ctx.identity, siteId);
  }

  if (id === "secure_device_list") {
    const { siteId, ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    return await secureDeviceList(ctx.client, ctx.identity, siteId);
  }

  if (id.startsWith("secure_info:")) {
    const { siteId, ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    return await secureDeviceInfo(ctx.client, ctx.identity, siteId, id.slice("secure_info:".length));
  }

  if (id.startsWith("secure_action:")) {
    const { ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    const action = id.slice("secure_action:".length);
    const result = await startSecureDeviceAction(ctx.client, ctx.identity, ctx.session, action as any);
    ctx.session = result.session;
    return result.message;
  }

  if (id.startsWith("secure_action_device:")) {
    const { ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    const [, action, device] = id.split(":");
    const result = await startSecureDeviceAction(ctx.client, ctx.identity, ctx.session, action as any, device);
    ctx.session = result.session;
    return result.message;
  }
  if (id === "ack") {
    if (!ctx.identity.canAcknowledge) {
      return optionMenu("NOT ALLOWED", ["You don't have permission to acknowledge alerts."], [{ id: "menu", label: "Main Menu" }]);
    }
    let ackQuery = ctx.client
      .from("alerts")
      .update({ is_read: true })
      .eq("company_id", ctx.identity.company_id)
      .eq("type", "panic_button")
      .eq("is_read", false);
    if (ctx.session.current_site_id) ackQuery = ackQuery.eq("site_id", ctx.session.current_site_id);
    else if (ctx.identity.allowed_site_ids.length) ackQuery = ackQuery.in("site_id", ctx.identity.allowed_site_ids);
    const { error } = await ackQuery;
    if (error) {
      return optionMenu("COULD NOT ACKNOWLEDGE", [error.message], [{ id: "menu", label: "Main Menu" }]);
    }
    return optionMenu("âœ… SOS ACKNOWLEDGED", ["All open SOS alerts are marked as acknowledged."], [
      { id: "attention", label: "Attention" },
      { id: "menu", label: "Main Menu" },
    ]);
  }

  if (id === "sos" || id === "missed" || id === "offline") {
    const { siteId, ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    return await attention(ctx.client, ctx.identity, id as "sos" | "missed" | "offline", siteId);
  }

  if (id === "problems") {
    const { siteId } = await ensureSiteContext(ctx);
    return await reportSummary(ctx.client, ctx.identity, siteId, "today", true);
  }

  if (id === "today" || id === "yesterday" || id === "week") {
    const { siteId, ask } = await ensureSiteContext(ctx);
    if (ask) return ask;
    return await reportSummary(ctx.client, ctx.identity, siteId, id as "today" | "yesterday" | "week");
  }

  if (id === "cancel") {
    ctx.session = await clearFlow(ctx.client, ctx.session);
    return mainMenu(ctx.identity, ctx.session);
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const inbound = await parseInboundWhatsAppRequest(req);
    const phone = normalizePhone(inbound.from);
    const body = inbound.body;
    const mediaUrls = inbound.mediaUrls;
    if (!phone) {
      return new Response(JSON.stringify({ error: "Missing From" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolved = await resolveIdentity(client, phone, body);
    if (resolved.kind === "unknown") {
      const text = renderText(LOCKOUT);
      return inbound.isTwilioForm
        ? new Response(twiml(text), { headers: { ...corsHeaders, "Content-Type": "text/xml" } })
        : new Response(JSON.stringify({ success: true, response: text }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const identity = { ...resolved.identity, phone };
    const session = await loadSession(client, identity);
    const ctx: Ctx = { client, identity, session };

    if (await hasDuplicateInbound(ctx, inbound.messageSid)) {
      console.info("[WA] duplicate inbound ignored", { messageSid: inbound.messageSid, companyId: identity.company_id });
      return inbound.isTwilioForm
        ? new Response(emptyTwiml(), { headers: { ...corsHeaders, "Content-Type": "text/xml" } })
        : new Response(JSON.stringify({ success: true, duplicate: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    await storeInbound(ctx, inbound);

    let message: OutMessage;

    if (resolved.kind === "linked") {
      message = {
        title: "âœ… NUMBER LINKED",
        lines: [
          `This WhatsApp number is now linked to MX Patrol${identity.display_name ? ` for ${identity.display_name}` : ""}.`,
        ],
        options: mainMenu(identity, ctx.session).options,
      };
    } else if (ctx.session.current_flow && /^(menu|main menu|hi|hello|cancel|exit|stop)$/i.test(body.trim())) {
      ctx.session = await clearFlow(client, ctx.session);
      message = mainMenu(identity, ctx.session);
    } else if (ctx.session.current_flow) {
      const result = await handleFlowInput(client, identity, ctx.session, body, mediaUrls);
      ctx.session = result.session;
      message = result.message;
    } else if (/^back$/i.test(body.trim())) {
      message = (await runSelection(ctx, "back")) ?? mainMenu(identity, ctx.session);
    } else {
      const selectionId = resolveMenuChoice(ctx.session, body);
      const selectionMessage = selectionId ? await runSelection(ctx, selectionId) : null;

      if (selectionMessage) {
        message = selectionMessage;
      } else if (selectionId) {
        message = await runIntent(ctx, { action: selectionId } as Intent);
      } else {
        const intent = keywordIntent(body) ?? await classifyIntent(body);
        message = await runIntent(ctx, intent);
      }
    }

    const text = await respondWith(ctx, message);

    if (inbound.isTwilioForm) {
      return new Response(twiml(text), { headers: { ...corsHeaders, "Content-Type": "text/xml" } });
    }
    return new Response(JSON.stringify({ success: true, response: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[WA] webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
