import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { z } from "npm:zod@3.25.76";
import { metaMenuPayload, sendMeta, MetaError } from "../_shared/whatsapp/meta.ts";
import { isServiceRoleBearer } from "../_shared/whatsapp/serviceAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const SendSchema = z.object({
  to: z.string().regex(/^(whatsapp:)?\+?[1-9]\d{6,14}$/),
  company_id: z.string().uuid(),
  message: z.string().min(1).max(4096).optional(),
  message_type: z.enum(["text", "alert", "system", "template"]).optional(),
  content_sid: z.string().regex(/^HX[0-9a-fA-F]{32}$/).optional(),
  content_variables: z.record(z.union([z.string(), z.number()])).optional(),
}).refine((value) => Boolean(value.message || value.content_sid), "Message or template required");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !anonKey) throw new Error("Service unavailable");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authHeader = req.headers.get("Authorization") ?? "";
    // Trusted internal callers (e.g. device-scan) authenticate with the service-role key.
    const isServiceCaller = isServiceRoleBearer(authHeader, SUPABASE_SERVICE_ROLE_KEY);
    let userId: string | null = null;
    if (!isServiceCaller) {
      const userClient = createClient(SUPABASE_URL, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      userId = user.id;
    }
    const parsed = SendSchema.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: "Invalid message fields" }), { status: 400, headers: corsHeaders });
    const { to, message, message_type, company_id, content_sid, content_variables } = parsed.data;
    if (isServiceCaller) {
      const { data: company } = await supabase.from("companies").select("id").eq("id", company_id).maybeSingle();
      if (!company) return new Response("Forbidden", { status: 403, headers: corsHeaders });
    } else {
      const { data: profile } = await supabase.from("profiles").select("company_id").eq("id", userId!).maybeSingle();
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId!);
      if (profile?.company_id !== company_id || !roles?.some((row) => ["admin", "supervisor"].includes(row.role))) return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }
    const metaToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const metaPhoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (metaToken && metaPhoneId && Deno.env.get("WHATSAPP_APP_SECRET")) {
      if (content_sid) return new Response(JSON.stringify({ error: "Twilio templates cannot be sent through Meta; use an approved Meta template" }), { status: 400, headers: corsHeaders });
      const phone = "+" + to.replace(/^whatsapp:/, "").replace(/^\+/, "");
      const { data: authorized } = await supabase.from("whatsapp_authorized_numbers").select("id").eq("company_id", company_id).eq("phone", phone).eq("status", "active").maybeSingle();
      if (!authorized) return new Response("Recipient not authorized for this company", { status: 403, headers: corsHeaders });
      const { data: recent } = await supabase.from("whatsapp_conversations").select("id, whatsapp_messages(created_at, direction)").eq("company_id", company_id).eq("phone_number", phone).maybeSingle();
      const cutoff = Date.now() - 24 * 3600000;
      const inWindow = recent?.whatsapp_messages?.some((row: { created_at: string; direction: string }) => row.direction === "inbound" && new Date(row.created_at).getTime() > cutoff);
      if (!inWindow) return new Response(JSON.stringify({ error: "Ask the recipient to message the business first; replies require an open 24-hour window" }), { status: 409, headers: corsHeaders });
      const id = await sendMeta({ token: metaToken, phoneNumberId: metaPhoneId }, metaMenuPayload(phone, { lines: [message ?? ""] }));
      if (recent) await supabase.from("whatsapp_messages").insert({ company_id, conversation_id: recent.id, direction: "outbound", message_body: message ?? "", message_type: message_type ?? "text", twilio_sid: id, metadata: { provider: "meta", status: "accepted" } });
      return new Response(JSON.stringify({ success: true, sid: id, provider: "meta" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!TWILIO_API_KEY) {
      return new Response(JSON.stringify({ error: "Twilio is not connected. Please connect Twilio in project settings." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    if (!to || !company_id || (!message && !content_sid)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, company_id, and either message or content_sid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (content_sid !== undefined && (typeof content_sid !== "string" || !/^HX[0-9a-fA-F]{32}$/.test(content_sid))) {
      return new Response(JSON.stringify({ error: "content_sid must be a Twilio Content SID (HX...)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let templateVariables: Record<string, string> | null = null;
    if (content_variables !== undefined && content_variables !== null) {
      if (typeof content_variables !== "object" || Array.isArray(content_variables)) {
        return new Response(JSON.stringify({ error: "content_variables must be an object of string values" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      templateVariables = {};
      for (const [key, value] of Object.entries(content_variables as Record<string, unknown>)) {
        if (typeof value !== "string" && typeof value !== "number") {
          return new Response(JSON.stringify({ error: `content_variables.${key} must be a string` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        templateVariables[key] = String(value);
      }
    }


    const cleanPhone = to.replace("whatsapp:", "").trim();
    const twilioFrom = Deno.env.get("TWILIO_WHATSAPP_NUMBER") || "";

    if (!twilioFrom) {
      return new Response(JSON.stringify({ error: "TWILIO_WHATSAPP_NUMBER not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find or create conversation
    let { data: conversation } = await supabase
      .from("whatsapp_conversations")
      .select("id")
      .eq("phone_number", cleanPhone)
      .eq("company_id", company_id)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv } = await supabase
        .from("whatsapp_conversations")
        .insert({ phone_number: cleanPhone, company_id, is_active: true })
        .select("id")
        .maybeSingle();
      conversation = newConv;
    }

    // Send via Twilio (template when content_sid given, otherwise plain text)
    const params: Record<string, string> = {
      To: `whatsapp:${cleanPhone}`,
      From: `whatsapp:${twilioFrom}`,
    };
    if (content_sid) {
      params.ContentSid = content_sid;
      if (templateVariables) params.ContentVariables = JSON.stringify(templateVariables);
    } else {
      params.Body = message ?? "";
    }

    const twilioResp = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });

    const twilioText = await twilioResp.text();

    if (!twilioResp.ok) {
      console.error(`Twilio send failed [${twilioResp.status}]: ${twilioText}`);
      return new Response(
        JSON.stringify({ error: "Twilio request failed", status: twilioResp.status, details: twilioText }),
        { status: twilioResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const twilioData = JSON.parse(twilioText);

    // Store message
    if (conversation) {
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conversation.id,
        company_id,
        direction: "outbound",
        message_body: content_sid
          ? `[template ${content_sid}]${templateVariables ? ` ${JSON.stringify(templateVariables)}` : ""}`
          : message,
        message_type: message_type || (content_sid ? "template" : "alert"),
        twilio_sid: twilioData.sid,
      });
    }

    return new Response(JSON.stringify({ success: true, sid: twilioData.sid, template: content_sid ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    if (error instanceof MetaError) return new Response(JSON.stringify({ error: "Meta request failed", status: error.status, details: error.details }), { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    console.error("Send error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
