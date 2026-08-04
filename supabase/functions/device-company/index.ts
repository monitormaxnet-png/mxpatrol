import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(ok: boolean, payload: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ ok, ...payload }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await serviceClient
      .from("devices")
      .select("company_id, site_id, device_identifier, device_name, pairing_status")
      .eq("device_identifier", device_identifier)
      .eq("pairing_status", "paired")
      .maybeSingle();

    if (error) throw error;

    if (!data?.company_id) {
      return respond(true, { device: null });
    }

    return respond(true, {
      device: {
        company_id: data.company_id,
        site_id: data.site_id ?? null,
        device_identifier: data.device_identifier,
        device_name: data.device_name ?? null,
        pairing_status: data.pairing_status ?? null,
      },
    });
  } catch (err: any) {
    console.error("Device company lookup error:", err);
    return respond(false, { error: err.message || "Internal server error" }, 500);
  }
});




