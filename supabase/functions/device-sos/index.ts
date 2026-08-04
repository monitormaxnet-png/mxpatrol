import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(ok: boolean, payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok, ...payload }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(false, { error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const deviceIdentifier = typeof body.device_identifier === "string" ? body.device_identifier.trim() : "";

    if (!deviceIdentifier) return respond(false, { error: "device_identifier is required" }, 400);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: device, error: deviceError } = await serviceClient
      .from("devices")
      .select("id, company_id, site_id, device_identifier, device_name, site_location, pairing_status")
      .eq("device_identifier", deviceIdentifier)
      .eq("pairing_status", "paired")
      .maybeSingle();

    if (deviceError) throw deviceError;
    if (!device?.company_id) return respond(false, { error: "Device is not paired" }, 403);

    const { data: company } = await serviceClient
      .from("companies")
      .select("name")
      .eq("id", device.company_id)
      .maybeSingle();

    const { data: site } = device.site_id
      ? await serviceClient
          .from("sites")
          .select("name")
          .eq("id", device.site_id)
          .eq("company_id", device.company_id)
          .maybeSingle()
      : { data: null };

    const companyName = company?.name ?? "Unknown company";
    const siteName = site?.name ?? device.site_location ?? "Unassigned site";

    const gps = body.gps && typeof body.gps === "object" ? body.gps as Record<string, unknown> : null;
    const key = body.key && typeof body.key === "object" ? body.key as Record<string, unknown> : {};
    const lat = typeof gps?.lat === "number" ? gps.lat : null;
    const lng = typeof gps?.lng === "number" ? gps.lng : null;
    const accuracy = typeof gps?.accuracy === "number" ? gps.accuracy : null;
    const keyName = typeof key.keyName === "string" ? key.keyName : "UNKNOWN";
    const keyCode = typeof key.keyCode === "number" ? key.keyCode : null;
    const durationMs = typeof key.durationMs === "number" ? key.durationMs : null;
    const triggeredAt = typeof body.triggered_at === "string" ? body.triggered_at : new Date().toISOString();
    const location = lat != null && lng != null
      ? `${lat.toFixed(6)}, ${lng.toFixed(6)}${accuracy ? ` (accuracy ${Math.round(accuracy)}m)` : ""}`
      : device.site_location ?? "GPS unavailable";

    await serviceClient
      .from("devices")
      .update({
        status: "online",
        last_seen_at: triggeredAt,
        current_gps_lat: lat,
        current_gps_lng: lng,
        current_gps_accuracy: accuracy,
        current_gps_at: lat != null && lng != null ? triggeredAt : null,
      })
      .eq("id", device.id);

    const fullDetails = [
      "SOS ALERT",
      `Company: ${companyName}`,
      `Company ID: ${device.company_id}`,
      `Site: ${siteName}`,
      `Site ID: ${device.site_id ?? "unassigned"}`,
      `Device: ${device.device_name ?? "Patrol device"}`,
      `Device ID: ${device.device_identifier}`,
      "Device registered: yes",
      `Location: ${location}`,
      `Location source: ${lat != null && lng != null ? "device GPS" : "registered device site"}`,
      `Hardware: ${keyName}${keyCode != null ? ` (${keyCode})` : ""}`,
      `Hold: ${durationMs != null ? Math.round(durationMs) : "n/a"}ms`,
      `Timestamp: ${triggeredAt}`,
    ].join(" | ");

    const { data: alert, error: alertError } = await serviceClient
      .from("alerts")
      .insert({
        company_id: device.company_id,
        guard_id: null,
        type: "panic_button",
        severity: "critical",
        message: fullDetails,
      })
      .select("id, company_id, type, severity, created_at")
      .single();

    if (alertError) throw alertError;

    const { data: incident, error: incidentError } = await serviceClient
      .from("incidents")
      .insert({
        company_id: device.company_id,
        title: `SOS panic - ${companyName} / ${siteName}`,
        description: fullDetails,
        severity: "critical",
        guard_id: null,
        location_lat: lat,
        location_lng: lng,
      })
      .select("id, company_id, title, severity, created_at")
      .single();

    if (incidentError) {
      console.error("device-sos incident insert error:", incidentError);
    }

    console.info("[SOS] Panic alert inserted", {
      alertId: alert?.id ?? null,
      incidentId: incident?.id ?? null,
      companyId: device.company_id,
      companyName,
      siteName,
      deviceIdentifier,
    });

    return respond(true, { alert, incident: incident ?? null, incident_error: incidentError?.message ?? null });
  } catch (err) {
    console.error("device-sos error:", err);
    const dbError = err as { code?: string; message?: string; details?: string; hint?: string };
    return respond(false, {
      code: dbError?.code ?? "DEVICE_SOS_ERROR",
      error: dbError?.message ?? (err instanceof Error ? err.message : "Internal server error"),
      details: dbError?.details ?? null,
      hint: dbError?.hint ?? null,
    }, 500);
  }
});
