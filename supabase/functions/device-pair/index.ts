import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizePairingCode(input: string): string {
  return input.trim().toUpperCase().replace(/^MXP[-\s]?/, "").replace(/[\s-]/g, "");
}

interface PairingRequest {
  pairing_code: string;
  device_metadata: {
    device_identifier?: string;
    device_name?: string;
    device_type?: string;
    model?: string;
    os?: string;
    imei?: string;
    serial_number?: string;
    nfc_enabled?: boolean;
  };
}

function respond(payload: Record<string, unknown>, status = 200): Response {
  const responseStatus = payload.success === false && status < 500 ? 200 : status;
  return new Response(
    JSON.stringify(payload),
    { status: responseStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return respond({ success: false, ok: false, error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: PairingRequest = await req.json();
    const { pairing_code, device_metadata } = body;
    const deviceIdentifier = device_metadata?.device_identifier?.trim();

    const code = typeof pairing_code === "string" ? normalizePairingCode(pairing_code) : "";

    if (!code || code.length !== 8) {
      return respond({ success: false, error: "Invalid pairing code" }, 400);
    }

    if (!deviceIdentifier) {
      return respond({ success: false, error: "device_metadata.device_identifier is required" }, 400);
    }

    const { data: device, error: findError } = await supabase
      .from("devices")
      .select("*")
      .eq("pairing_code", code)
      .single();

    if (findError || !device) {
      return respond({ success: false, error: "Pairing code not found" }, 404);
    }

    if (device.pairing_status === "paired") {
      return respond({ success: false, error: "Device already paired" }, 409);
    }

    if (device.pairing_expires_at && new Date(device.pairing_expires_at) < new Date()) {
      await supabase
        .from("devices")
        .update({ pairing_status: "expired" })
        .eq("id", device.id);

      return respond({ success: false, error: "Pairing code has expired" }, 410);
    }

    const { data: conflictingDevice, error: conflictError } = await supabase
      .from("devices")
      .select("id")
      .eq("device_identifier", deviceIdentifier)
      .neq("id", device.id)
      .maybeSingle();

    if (conflictError) throw conflictError;

    if (conflictingDevice) {
      return respond({ success: false, error: "This RG360 is already paired to another device record" }, 409);
    }

    const updateData: Record<string, unknown> = {
      device_identifier: deviceIdentifier,
      pairing_status: "paired",
      pairing_code: null,
      pairing_expires_at: null,
      status: "online",
      enrolled_via: "pairing_code",
      last_seen_at: new Date().toISOString(),
    };

    if (device_metadata) {
      if (device_metadata.device_name) updateData.device_name = device_metadata.device_name;
      if (device_metadata.imei || device_metadata.serial_number) updateData.serial_number = device_metadata.imei || device_metadata.serial_number;
      if (device_metadata.device_type) updateData.device_type = device_metadata.device_type;
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
      console.error("Device pair update error:", updateError);
      return respond({ success: false, error: "Failed to activate device" }, 500);
    }

    return respond({
      success: true,
      ok: true,
      device_id: updated.id,
      company_id: updated.company_id,
      site_id: updated.site_id ?? null,
      device_identifier: updated.device_identifier,
      device_name: updated.device_name,
      assigned_guard: updated.guard_id,
      site_location: updated.site_location,
      message: "Device paired and activated successfully",
    });
  } catch (err) {
    console.error("Device pair error:", err);
    return respond({ success: false, error: "Internal server error" }, 500);
  }
});




