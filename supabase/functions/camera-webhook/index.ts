import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookSecret = Deno.env.get("CAMERA_WEBHOOK_SECRET");
    if (webhookSecret) {
      const providedSecret = req.headers.get("x-webhook-secret");
      if (providedSecret !== webhookSecret) {
        return new Response(JSON.stringify({ error: "Invalid webhook secret" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    // Validate required fields
    const { camera_id, event_type, severity, description, thumbnail_url, clip_url, metadata } = body;
    if (!camera_id || !event_type) {
      return new Response(JSON.stringify({ error: "camera_id and event_type are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up camera to get company_id
    const { data: camera, error: camError } = await supabase
      .from("cameras")
      .select("id, company_id, name, checkpoint_id")
      .eq("id", camera_id)
      .single();

    if (camError || !camera) {
      return new Response(JSON.stringify({ error: "Camera not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert camera event
    const { data: event, error: eventError } = await supabase
      .from("camera_events")
      .insert({
        camera_id,
        company_id: camera.company_id,
        event_type,
        severity: severity || "medium",
        description,
        thumbnail_url,
        clip_url,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (eventError) {
      console.error("Error inserting camera event:", eventError);
      return new Response(JSON.stringify({ error: "Failed to create event" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create alert for critical events
    const alertSeverities = ["intrusion", "motion_restricted", "suspicious_behavior"];
    if (alertSeverities.includes(event_type)) {
      await supabase.from("alerts").insert({
        company_id: camera.company_id,
        type: "anomaly",
        severity: severity === "critical" ? "critical" : "high",
        message: `📹 ${event_type.replace(/_/g, " ").toUpperCase()} detected on camera "${camera.name}"${description ? `: ${description}` : ""}`,
      });
    }

    // Create AI insight for analytics
    if (alertSeverities.includes(event_type) || event_type === "loitering") {
      await supabase.from("ai_insights").insert({
        company_id: camera.company_id,
        type: "camera_detection",
        severity: severity || "medium",
        summary: `Camera AI detected ${event_type.replace(/_/g, " ")} on "${camera.name}"`,
        data: { camera_id, event_type, event_id: event.id, detected_at: event.detected_at },
      });
    }

    // Update camera status to online (it sent an event)
    await supabase.from("cameras").update({ status: "online", updated_at: new Date().toISOString() }).eq("id", camera_id);

    return new Response(JSON.stringify({ success: true, event_id: event.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
