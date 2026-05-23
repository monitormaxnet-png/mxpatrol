import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-token",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { device_id, battery_level, ip_address, app_version, metadata } = body;

    if (!device_id) {
      return new Response(
        JSON.stringify({ error: "device_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract per-device auth token (Bearer header or x-device-token)
    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const providedToken = bearer || req.headers.get("x-device-token") || "";

    if (!providedToken) {
      return new Response(
        JSON.stringify({ error: "Missing device auth token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: device, error: deviceErr } = await serviceClient
      .from("devices")
      .select("id, company_id, status, auth_token_hash")
      .eq("id", device_id)
      .single();

    if (deviceErr || !device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!device.auth_token_hash) {
      return new Response(
        JSON.stringify({ error: "Device must be re-enrolled to obtain an auth token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const providedHash = await sha256Hex(providedToken);
    if (!timingSafeEqual(providedHash, device.auth_token_hash)) {
      return new Response(
        JSON.stringify({ error: "Invalid device auth token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    const newStatus = battery_level != null && battery_level <= 15 ? "low_battery" : "online";
    await serviceClient
      .from("devices")
      .update({
        status: newStatus,
        battery_level: battery_level ?? null,
        last_seen_at: now,
      })
      .eq("id", device_id);

    await serviceClient.from("device_heartbeats").insert({
      device_id,
      company_id: device.company_id,
      battery_level: battery_level ?? null,
      is_online: true,
      ip_address: ip_address || null,
      app_version: app_version || null,
      metadata: metadata || {},
    });

    const { data: pendingCommands } = await serviceClient
      .from("device_commands")
      .select("*")
      .eq("device_id", device_id)
      .eq("status", "pending")
      .order("issued_at", { ascending: true })
      .limit(10);

    if (pendingCommands && pendingCommands.length > 0) {
      const ids = pendingCommands.map((c: any) => c.id);
      await serviceClient
        .from("device_commands")
        .update({ status: "sent", sent_at: now })
        .in("id", ids);
    }

    return new Response(
      JSON.stringify({
        status: newStatus,
        commands: pendingCommands || [],
        server_time: now,
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
