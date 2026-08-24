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

    const body: PairingRequest & { mode?: string } = await req.json();
    const { pairing_code, device_metadata } = body;
    const deviceIdentifier = device_metadata?.device_identifier?.trim();

    // Device-initiated pairing: the unpaired MX Patrol app asks for the code it will display.
    if (body.mode === "request_code") {
      if (!deviceIdentifier) {
        return respond({ success: false, error: "device_metadata.device_identifier is required" }, 400);
      }

      const { data: alreadyPaired } = await supabase
        .from("devices")
        .select("id, pairing_status")
        .eq("device_identifier", deviceIdentifier)
        .eq("pairing_status", "paired")
        .maybeSingle();
      if (alreadyPaired) {
        return respond({ success: false, error: "This device is already registered" }, 409);
      }

      const { data: pending } = await supabase
        .from("device_pairing_requests")
        .select("id, pairing_code, expires_at")
        .eq("device_identifier", deviceIdentifier)
        .eq("status", "pending")
        .maybeSingle();

      if (pending && new Date(pending.expires_at) > new Date()) {
        return respond({
          success: true,
          ok: true,
          pairing_code: pending.pairing_code,
          display_code: `MX-${pending.pairing_code}`,
          expires_at: pending.expires_at,
        });
      }

      if (pending) {
        await supabase.from("device_pairing_requests").update({ status: "expired" }).eq("id", pending.id);
      }

      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "";
      for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const { data: created, error: createError } = await supabase
        .from("device_pairing_requests")
        .insert({
          pairing_code: code,
          device_identifier: deviceIdentifier,
          device_metadata: device_metadata ?? {},
          status: "pending",
          expires_at: expiresAt,
        })
        .select("pairing_code, expires_at")
        .single();

      if (createError) {
        console.error("Pairing request error:", createError);
        return respond({ success: false, error: "Could not issue a pairing code" }, 500);
      }

      return respond({
        success: true,
        ok: true,
        pairing_code: created.pairing_code,
        display_code: `MX-${created.pairing_code}`,
        expires_at: created.expires_at,
      });
    }

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
      if (device_metadata.public_key) {
        updateData.public_key = device_metadata.public_key;
        updateData.public_key_algorithm = device_metadata.public_key_algorithm || "ECDSA_P256_SHA256";
        updateData.device_key_registered_at = new Date().toISOString();
        updateData.secure_mode_enabled = true;
        updateData.secure_mode_status = "active";
      }
      if (device_metadata.secure_device_state) {
        updateData.app_version = device_metadata.secure_device_state.appVersion || null;
        updateData.app_package_name = device_metadata.secure_device_state.packageName || null;
        updateData.app_signature_sha256 = device_metadata.secure_device_state.appSignatureSha256 || null;
        updateData.is_debug_build = Boolean(device_metadata.secure_device_state.isDebugBuild);
        updateData.device_owner_active = Boolean(device_metadata.secure_device_state.deviceOwner);
        updateData.kiosk_active = Boolean(device_metadata.secure_device_state.kioskActive);
        updateData.developer_mode_detected = Boolean(device_metadata.secure_device_state.developerModeDetected);
        updateData.adb_detected = Boolean(device_metadata.secure_device_state.adbDetected);
        updateData.last_integrity_check_at = new Date().toISOString();
      }
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




