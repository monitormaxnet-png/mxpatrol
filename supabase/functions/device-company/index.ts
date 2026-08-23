import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(ok: boolean, payload: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ ok, ...payload }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return respond(false, { error: "Method not allowed", device: null }, 405);

  try {
    const { device_identifier } = await req.json();

    if (!device_identifier || typeof device_identifier !== "string") {
      return respond(false, { error: "device_identifier is required" }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const runQuery = () =>
      serviceClient
        .from("devices")
        .select("id, company_id, site_id, device_identifier, device_name, pairing_status, secure_mode_enabled, secure_mode_status, minimum_app_version, maintenance_expires_at")
        .eq("device_identifier", device_identifier)
        .eq("pairing_status", "paired")
        .maybeSingle();

    let data: any = null;
    let error: any = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await runQuery();
      data = result.data;
      error = result.error;
      // PGRST002 = PostgREST schema cache not loaded yet (backend warming up)
      if (!error || error.code !== "PGRST002") break;
      console.warn(`device-company schema cache not ready, retrying (${attempt + 1}/4)`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }

    if (error) {
      if (error.code === "PGRST002") {
        return respond(false, { error: "Backend warming up, please retry", device: null }, 503);
      }
      throw error;
    }

    if (!data?.company_id) {
      return respond(true, { device: null });
    }

    return respond(true, {
      device: {
        id: data.id,
        company_id: data.company_id,
        site_id: data.site_id ?? null,
        device_identifier: data.device_identifier,
        device_name: data.device_name ?? null,
        pairing_status: data.pairing_status ?? null,
        secure_mode_enabled: data.secure_mode_enabled ?? false,
        secure_mode_status: data.secure_mode_status ?? "not_configured",
        minimum_app_version: data.minimum_app_version ?? null,
        maintenance_expires_at: data.maintenance_expires_at ?? null,
      },
    });
  } catch (err: any) {
    console.error("Device company lookup error:", err);
    return respond(false, { error: err.message || "Internal server error" }, 500);
  }
});