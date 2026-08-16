import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { to, message, message_type, company_id, content_sid, content_variables } = await req.json();

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
      .single();

    if (!conversation) {
      const { data: newConv } = await supabase
        .from("whatsapp_conversations")
        .insert({ phone_number: cleanPhone, company_id, is_active: true })
        .select("id")
        .single();
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
      params.Body = message;
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
    console.error("Send error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
