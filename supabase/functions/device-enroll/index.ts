import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function respond(ok: boolean, payload: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ ok, ...payload }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/** Decode base64 that may be standard or URL-safe */
function safeAtob(str: string): string {
  // Normalize URL-safe base64 to standard
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (s.length % 4 !== 0) s += "=";
  return atob(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { qr_token, device_metadata } = body;

    if (!qr_token || !device_metadata?.device_identifier) {
      return respond(false, { error: "qr_token and device_metadata.device_identifier are required" });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse and verify token
    const parts = qr_token.split(".");
    if (parts.length !== 2) {
      return respond(false, { error: "Invalid token format" });
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

    let sigBytes: Uint8Array;
    try {
      sigBytes = Uint8Array.from(safeAtob(sigB64), (c) => c.charCodeAt(0));
    } catch (e) {
      console.error("Signature decode error:", e);
      return respond(false, { error: "Invalid token signature encoding" });
    }

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      encoder.encode(payloadB64)
    );

    if (!valid) {
      return respond(false, { error: "Invalid token signature" });
    }

    let payload: { tid: string; app: string; nonce: string; exp: number };
    try {
      payload = JSON.parse(safeAtob(payloadB64));
    } catch {
      return respond(false, { error: "Malformed token payload" });
    }

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return respond(false, { error: "Token expired" });
    }

    // Find and validate token in DB
    const { data: tokenRecord, error: tokenErr } = await serviceClient
      .from("enrollment_tokens")
      .select("*")
      .eq("token", qr_token)
      .eq("company_id", payload.tid)
      .single();

    if (tokenErr || !tokenRecord) {
      return respond(false, { error: "Token not found" });
    }

    if (tokenRecord.used) {
      return respond(false, { error: "Token already used" });
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

    return respond(true, {
      device_id: deviceId,
      company_id: payload.tid,
      app_type: payload.app,
    });
  } catch (err: any) {
    console.error("Device enroll error:", err);
    return respond(false, { error: err.message || "Internal server error" });
  }
});
