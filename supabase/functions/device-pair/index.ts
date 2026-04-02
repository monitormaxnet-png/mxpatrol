import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.4/cors";

interface PairingRequest {
  pairing_code: string;
  device_metadata: {
    device_name?: string;
    model?: string;
    os?: string;
    imei?: string;
    nfc_enabled?: boolean;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: PairingRequest = await req.json();
    const { pairing_code, device_metadata } = body;

    if (!pairing_code || typeof pairing_code !== "string" || pairing_code.trim().length < 6) {
      return new Response(
        JSON.stringify({ error: "Invalid pairing code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const code = pairing_code.trim().toUpperCase();

    // Find device with this pairing code
    const { data: device, error: findError } = await supabase
      .from("devices")
      .select("*")
      .eq("pairing_code", code)
      .single();

    if (findError || !device) {
      return new Response(
        JSON.stringify({ error: "Pairing code not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already paired
    if (device.pairing_status === "paired") {
      return new Response(
        JSON.stringify({ error: "Device already paired" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiry
    if (device.pairing_expires_at && new Date(device.pairing_expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from("devices")
        .update({ pairing_status: "expired" })
        .eq("id", device.id);

      return new Response(
        JSON.stringify({ error: "Pairing code has expired" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Activate the device
    const updateData: Record<string, unknown> = {
      pairing_status: "paired",
      status: "online",
      last_seen_at: new Date().toISOString(),
    };

    if (device_metadata) {
      if (device_metadata.device_name) updateData.device_name = device_metadata.device_name;
      if (device_metadata.imei) updateData.serial_number = device_metadata.imei;
      const notes = [
        device_metadata.model && `Model: ${device_metadata.model}`,
        device_metadata.os && `OS: ${device_metadata.os}`,
        device_metadata.nfc_enabled !== undefined && `NFC: ${device_metadata.nfc_enabled ? "Yes" : "No"}`,
      ].filter(Boolean).join("; ");
      if (notes) updateData.notes = notes;
    }

    const { data: updated, error: updateError } = await supabase
      .from("devices")
      .update(updateData)
      .eq("id", device.id)
      .select()
      .single();

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to activate device" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        device_id: updated.id,
        device_name: updated.device_name,
        assigned_guard: updated.guard_id,
        site_location: updated.site_location,
        message: "Device paired and activated successfully",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
