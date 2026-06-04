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
    const { device_id, battery_level, ip_address, app_version, metadata } = body;

    if (!device_id) {
      return new Response(
        JSON.stringify({ error: "device_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate device exists
    const { data: device, error: deviceErr } = await serviceClient
      .from("devices")
      .select("id, company_id, status")
      .eq("id", device_id)
      .single();

    if (deviceErr || !device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    // Update device status
    const newStatus = battery_level != null && battery_level <= 15 ? "low_battery" : "online";
    await serviceClient
      .from("devices")
      .update({
        status: newStatus,
        battery_level: battery_level ?? null,
        last_seen_at: now,
      })
      .eq("id", device_id);

    // Insert heartbeat record
    await serviceClient.from("device_heartbeats").insert({
      device_id,
      company_id: device.company_id,
      battery_level: battery_level ?? null,
      is_online: true,
      ip_address: ip_address || null,
      app_version: app_version || null,
      metadata: metadata || {},
    });

    // Fetch pending commands for this device
    const { data: pendingCommands } = await serviceClient
      .from("device_commands")
      .select("*")
      .eq("device_id", device_id)
      .eq("status", "pending")
      .order("issued_at", { ascending: true })
      .limit(10);

    // Mark fetched commands as sent
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
