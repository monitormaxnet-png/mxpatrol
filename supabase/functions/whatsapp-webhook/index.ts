import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { normalizePhone, type Identity, type OutMessage, type SessionRow, type SiteRow } from "./lib/types.ts";
import { emptyTwiml, parseInboundWhatsAppRequest, type InboundWhatsAppMessage } from "./lib/request.ts";
import { allowedSites, resolveIdentity } from "./lib/identity.ts";
import { clearFlow, loadSession, patchSession } from "./lib/session.ts";
import { renderText, sendLocation, twiml } from "./lib/render.ts";
import { classifyIntent, keywordIntent, type Intent } from "./lib/askmx.ts";
import { handleFlowInput, startFlow } from "./lib/flows.ts";
import {
  activePatrols,
  attention,
  deviceDetail,
  deviceList,
  incidentsView,
  liveNow,
  mainMenu,
  reportPeriodMenu,
  reportSummary,
  setupMenu,
} from "./lib/views.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOCKOUT: OutMessage = {
  title: "🔐 MX Patrol account required",
  lines: [
    "This WhatsApp number isn't linked to an MX Patrol account.",
    "",
    "Ask your company administrator to authorize this number, or send the link code from your MX Patrol profile.",
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

function siteChooser(sites: SiteRow[], allowAll: boolean): OutMessage {
  const options = sites.slice(0, 9).map((site) => ({ id: `site:${site.id}`, label: site.name }));
  if (allowAll) options.push({ id: "site:all", label: "All Sites" });
  return optionMenu("WHICH SITE?", ["Choose the site you want to work with."], options);
}

/** Maps a numeric/keyword reply against the options we last showed. */
function resolveLastMenuChoice(session: SessionRow, input: string): string | null {
  const options = (session.temporary_data?.["last_options"] ?? []) as Array<{ id: string; label: string }>;
  if (!Array.isArray(options) || !options.length) return null;
  const trimmed = input.trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1].id;
  const lower = trimmed.toLowerCase();
  const match = options.find((option) => option.label.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim() === lower);
  return match?.id ?? null;
}

async function respondWith(ctx: Ctx, message: OutMessage): Promise<string> {
  await patchSession(ctx.client, ctx.session, {
    temporary_data: {
      ...(ctx.session.temporary_data ?? {}),
      last_options: message.options ?? [],
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
async function ensureSiteContext(ctx: Ctx, allowAll: boolean): Promise<{ siteId: string | null; ask?: OutMessage }> {
  if (ctx.session.site_scope === "all") return { siteId: null };
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
  return { siteId: null, ask: siteChooser(sites, allowAll) };
}

async function runIntent(ctx: Ctx, intent: Intent): Promise<OutMessage> {
  switch (intent.action) {
    case "menu":
      return mainMenu(ctx.identity, ctx.session);

    case "change_site": {
      const sites = await allowedSites(ctx.client, ctx.identity);
      ctx.session = await patchSession(ctx.client, ctx.session, {
        current_site_id: null,
        current_site_name: null,
        site_scope: "single",
      });
      return siteChooser(sites, true);
    }

    case "live": {
      const { siteId, ask } = await ensureSiteContext(ctx, true);
      if (ask) return ask;
      return await liveNow(ctx.client, ctx.identity, siteId);
    }

    case "patrols": {
      const { siteId, ask } = await ensureSiteContext(ctx, true);
      if (ask) return ask;
      return await activePatrols(ctx.client, ctx.identity, siteId);
    }

    case "attention": {
      const { siteId, ask } = await ensureSiteContext(ctx, true);
      if (ask) return ask;
      return await attention(ctx.client, ctx.identity, intent.filter ?? "all", siteId);
    }

    case "devices": {
      const { siteId, ask } = await ensureSiteContext(ctx, true);
      if (ask) return ask;
      const message = await deviceList(ctx.client, ctx.identity, siteId);
      if (intent.filter === "offline") {
        message.options = (message.options ?? []).filter((option) => option.label.includes("Offline"));
        message.lines = message.options.length ? message.lines : ["🟢 All devices are online."];
      }
      return message;
    }

    case "device_detail": {
      const { message, gps } = await deviceDetail(ctx.client, ctx.identity, intent.device);
      if (gps) await sendLocation(ctx.identity.phone, gps.lat, gps.lng, gps.label);
      return message;
    }

    case "incidents": {
      const { siteId, ask } = await ensureSiteContext(ctx, true);
      if (ask) return ask;
      return await incidentsView(ctx.client, ctx.identity, siteId);
    }

    case "reports": {
      if (!intent.period) return reportPeriodMenu();
      const { siteId, ask } = await ensureSiteContext(ctx, true);
      if (ask) return ask;
      return await reportSummary(ctx.client, ctx.identity, siteId, intent.period, intent.problems_only ?? false);
    }

    case "setup":
      if (!ctx.identity.canSetup) {
        return optionMenu("NOT ALLOWED", ["Only company administrators can change setup."], [{ id: "menu", label: "Main Menu" }]);
      }
      return setupMenu();

    case "register_device":
    case "add_checkpoint":
    case "create_patrol":
    case "report_incident": {
      const flow = intent.action === "register_device"
        ? "REGISTER_DEVICE"
        : intent.action === "add_checkpoint"
          ? "CREATE_CHECKPOINT"
          : intent.action === "create_patrol"
            ? "CREATE_PATROL"
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
  if (id.startsWith("site:")) {
    const value = id.slice(5);
    if (value === "all") {
      ctx.session = await patchSession(ctx.client, ctx.session, {
        current_site_id: null,
        current_site_name: null,
        site_scope: "all",
      });
      return mainMenu(ctx.identity, ctx.session);
    }
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
    return optionMenu("✅ SOS ACKNOWLEDGED", ["All open SOS alerts are marked as acknowledged."], [
      { id: "attention", label: "Attention" },
      { id: "menu", label: "Main Menu" },
    ]);
  }

  if (id === "sos" || id === "missed" || id === "offline") {
    const { siteId, ask } = await ensureSiteContext(ctx, true);
    if (ask) return ask;
    return await attention(ctx.client, ctx.identity, id as "sos" | "missed" | "offline", siteId);
  }

  if (id === "problems") {
    const { siteId } = await ensureSiteContext(ctx, true);
    return await reportSummary(ctx.client, ctx.identity, siteId, "today", true);
  }

  if (id === "today" || id === "yesterday" || id === "week") {
    const { siteId, ask } = await ensureSiteContext(ctx, true);
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
        title: "✅ NUMBER LINKED",
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
    } else {
      const selectionId = resolveLastMenuChoice(ctx.session, body);
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
