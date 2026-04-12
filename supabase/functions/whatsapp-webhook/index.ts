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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Twilio sends form-encoded data for webhooks
    const contentType = req.headers.get("content-type") || "";
    let fromNumber: string;
    let body: string;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      fromNumber = (formData.get("From") as string) || "";
      body = (formData.get("Body") as string) || "";
    } else {
      const json = await req.json();
      fromNumber = json.From || json.from || "";
      body = json.Body || json.body || "";
    }

    if (!fromNumber || !body) {
      return new Response(JSON.stringify({ error: "Missing From or Body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clean phone number (remove whatsapp: prefix)
    const cleanPhone = fromNumber.replace("whatsapp:", "").trim();

    // Find or create conversation — look up guard by phone
    const { data: guard } = await supabase
      .from("guards")
      .select("id, company_id, full_name, badge_number")
      .eq("phone", cleanPhone)
      .eq("is_active", true)
      .single();

    const companyId = guard?.company_id || "a0000000-0000-0000-0000-000000000001";

    // Find existing conversation or create one
    let { data: conversation } = await supabase
      .from("whatsapp_conversations")
      .select("id")
      .eq("phone_number", cleanPhone)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .single();

    if (!conversation) {
      const { data: newConv, error: convErr } = await supabase
        .from("whatsapp_conversations")
        .insert({
          phone_number: cleanPhone,
          company_id: companyId,
          guard_id: guard?.id || null,
          is_active: true,
        })
        .select("id")
        .single();

      if (convErr) throw convErr;
      conversation = newConv;
    }

    // Classify message type
    const lowerBody = body.toLowerCase().trim();
    let messageType = "text";
    if (
      lowerBody.includes("status") ||
      lowerBody.includes("patrol") ||
      lowerBody.includes("report") ||
      lowerBody.includes("summary")
    ) {
      messageType = "status_query";
    } else if (
      lowerBody.includes("incident") ||
      lowerBody.includes("emergency") ||
      lowerBody.includes("alert") ||
      lowerBody.includes("suspicious")
    ) {
      messageType = "incident_report";
    } else if (
      lowerBody.includes("check in") ||
      lowerBody.includes("checkin") ||
      lowerBody.includes("on duty")
    ) {
      messageType = "text";
    }

    // Store inbound message
    await supabase.from("whatsapp_messages").insert({
      conversation_id: conversation!.id,
      company_id: companyId,
      direction: "inbound",
      message_body: body,
      message_type: messageType,
    });

    // Build AI context based on message type
    let contextData = "";

    if (messageType === "status_query") {
      // Fetch patrol data
      const { data: patrols } = await supabase
        .from("patrols")
        .select("name, status, guard_id, started_at, completed_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(10);

      const { data: recentAlerts } = await supabase
        .from("alerts")
        .select("type, message, severity, created_at")
        .eq("company_id", companyId)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(5);

      contextData = `
RECENT PATROLS: ${JSON.stringify(patrols || [])}
UNREAD ALERTS: ${JSON.stringify(recentAlerts || [])}`;
    } else if (messageType === "incident_report") {
      contextData = `
The guard is reporting an incident. Extract details and confirm the report.
Guard info: ${guard ? `${guard.full_name} (Badge: ${guard.badge_number})` : "Unknown guard"}`;
    }

    // Generate AI response
    const systemPrompt = `You are a security AI assistant for a patrol management platform. You communicate via WhatsApp.
Keep responses concise (under 300 chars when possible). Use simple formatting (no markdown, use plain text with line breaks).
${guard ? `Speaking with: ${guard.full_name} (Badge: ${guard.badge_number})` : "Speaking with: Unknown user"}
${contextData}

For patrol status queries: Summarize active patrols, recent alerts, and any issues.
For incident reports: Acknowledge, ask for location/severity if not provided, confirm it will be escalated.
For general messages: Be helpful and security-focused.`;

    let aiResponse = "I'm processing your request. A supervisor will follow up shortly.";

    if (LOVABLE_API_KEY) {
      try {
        const aiResp = await fetch(
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: body },
              ],
            }),
          }
        );

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          aiResponse =
            aiData.choices?.[0]?.message?.content || aiResponse;
        } else {
          const errText = await aiResp.text();
          console.error("AI gateway error:", aiResp.status, errText);
        }
      } catch (e) {
        console.error("AI error:", e);
      }
    }

    // Store outbound message
    await supabase.from("whatsapp_messages").insert({
      conversation_id: conversation!.id,
      company_id: companyId,
      direction: "outbound",
      message_body: aiResponse,
      message_type: "system",
    });

    // If incident reported, create an incident record
    if (messageType === "incident_report" && guard) {
      await supabase.from("incidents").insert({
        company_id: companyId,
        guard_id: guard.id,
        title: `WhatsApp Report: ${body.substring(0, 80)}`,
        description: body,
        severity: "medium",
        ai_classification: "whatsapp_report",
        ai_suggested_action: "Review and dispatch supervisor",
      });
    }

    // Send reply via Twilio if configured
    if (TWILIO_API_KEY && LOVABLE_API_KEY) {
      try {
        // Get Twilio phone number from env or use a configured one
        const twilioFrom = Deno.env.get("TWILIO_WHATSAPP_NUMBER") || "";
        if (twilioFrom) {
          const twilioResp = await fetch(`${GATEWAY_URL}/Messages.json`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": TWILIO_API_KEY,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: `whatsapp:${cleanPhone}`,
              From: `whatsapp:${twilioFrom}`,
              Body: aiResponse,
            }),
          });

          if (!twilioResp.ok) {
            console.error("Twilio send error:", await twilioResp.text());
          }
        }
      } catch (e) {
        console.error("Twilio error:", e);
      }
    }

    // For Twilio webhook, return TwiML
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${aiResponse.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Message>
</Response>`;
      return new Response(twiml, {
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    return new Response(JSON.stringify({ success: true, response: aiResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
