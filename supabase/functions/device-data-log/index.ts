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

const stringOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(false, { code: "METHOD_NOT_ALLOWED", error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const deviceIdentifier = stringOrNull(body.device_identifier);
    const companyId = stringOrNull(body.company_id);
    const scanLogId = stringOrNull(body.scan_log_id);
    const responses = body.responses && typeof body.responses === "object" && !Array.isArray(body.responses)
      ? body.responses as Record<string, unknown>
      : null;

    if (!deviceIdentifier) return respond(false, { code: "BAD_REQUEST", error: "device_identifier is required" });
    if (!companyId) return respond(false, { code: "BAD_REQUEST", error: "company_id is required" });
    if (!scanLogId) return respond(false, { code: "BAD_REQUEST", error: "scan_log_id is required" });
    if (!responses) return respond(false, { code: "BAD_REQUEST", error: "responses object is required" });

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: device, error: deviceError } = await service
      .from("devices")
      .select("id, company_id, device_identifier, pairing_status")
      .eq("device_identifier", deviceIdentifier)
      .eq("pairing_status", "paired")
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device?.company_id) return respond(false, { code: "DEVICE_NOT_ENROLLED", error: "Device is not enrolled" });
    if (device.company_id !== companyId) return respond(false, { code: "COMPANY_MISMATCH", error: "Device company mismatch" });

    const { data: scanLog, error: scanError } = await service
      .from("scan_logs")
      .select("id, company_id, device_identifier")
      .eq("id", scanLogId)
      .maybeSingle();
    if (scanError) throw scanError;
    if (!scanLog || scanLog.company_id !== device.company_id) {
      return respond(false, { code: "SCAN_NOT_FOUND", error: "Scan not found for this company" });
    }

    const { data, error } = await service.rpc("submit_data_log_submission", {
      p_scan_log_id: scanLogId,
      p_responses_json: responses,
      p_submitted_by: stringOrNull(body.submitted_by),
    });

    if (error) {
      console.error("[device-data-log] submission failed", error.message);
      const validation = /validation failed/i.test(error.message ?? "");
      return respond(false, {
        code: validation ? "DATA_LOG_VALIDATION_FAILED" : "DATA_LOG_SUBMISSION_FAILED",
        error: error.message,
      });
    }

    const row = Array.isArray(data) ? data[0] : data;
    return respond(true, {
      code: "DATA_LOG_SUBMITTED",
      submission: row ?? null,
      message: "Data log submitted",
    });
  } catch (err) {
    console.error("[device-data-log] error", err);
    return respond(false, {
      code: "DEVICE_DATA_LOG_ERROR",
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});
