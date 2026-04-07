import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { qr_token, device_metadata } = body;

    if (!qr_token || !device_metadata?.device_identifier) {
      return new Response(
        JSON.stringify({ error: "qr_token and device_metadata.device_identifier are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse and verify token
    const parts = qr_token.split(".");
    if (parts.length !== 2) {
      return new Response(
        JSON.stringify({ error: "Invalid token format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [payloadB64, sigB64] = parts;

    // Verify HMAC
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      encoder.encode(payloadB64)
    );

    if (!valid) {
      return new Response(
        JSON.stringify({ error: "Invalid token signature" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload: { tid: string; app: string; nonce: string; exp: number };
    try {
      payload = JSON.parse(atob(payloadB64));
    } catch {
      return new Response(
        JSON.stringify({ error: "Malformed token payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return new Response(
        JSON.stringify({ error: "Token expired" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find and validate token in DB
    const { data: tokenRecord, error: tokenErr } = await serviceClient
      .from("enrollment_tokens")
      .select("*")
      .eq("token", qr_token)
      .eq("company_id", payload.tid)
      .single();

    if (tokenErr || !tokenRecord) {
      return new Response(
        JSON.stringify({ error: "Token not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tokenRecord.used) {
      return new Response(
        JSON.stringify({ error: "Token already used" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if device already exists
    const { data: existingDevice } = await serviceClient
      .from("devices")
      .select("id")
      .eq("device_identifier", device_metadata.device_identifier)
      .eq("company_id", payload.tid)
      .maybeSingle();

    let deviceId: string;

    if (existingDevice) {
      // Update existing device
      const { error: updateErr } = await serviceClient
        .from("devices")
        .update({
          app_type: payload.app,
          device_name: device_metadata.device_name || null,
          serial_number: device_metadata.serial_number || null,
          status: "online",
          enrolled_via: "qr",
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existingDevice.id);
      if (updateErr) throw updateErr;
      deviceId = existingDevice.id;
    } else {
      // Create new device
      const { data: newDevice, error: insertErr } = await serviceClient
        .from("devices")
        .insert({
          company_id: payload.tid,
          device_identifier: device_metadata.device_identifier,
          device_name: device_metadata.device_name || device_metadata.device_identifier,
          device_type: device_metadata.device_type || "mobile",
          serial_number: device_metadata.serial_number || null,
          app_type: payload.app,
          status: "online",
          enrolled_via: "qr",
          pairing_status: "paired",
          last_seen_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      deviceId = newDevice.id;
    }

    // Mark token as used
    await serviceClient
      .from("enrollment_tokens")
      .update({ used: true, used_by_device_id: deviceId })
      .eq("id", tokenRecord.id);

    // Log activity
    await serviceClient.from("device_activity_logs").insert({
      device_id: deviceId,
      company_id: payload.tid,
      action: "enrolled",
      metadata: {
        enrolled_via: "qr",
        app_type: payload.app,
        device_metadata,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        device_id: deviceId,
        company_id: payload.tid,
        app_type: payload.app,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
