import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const fail = (error: string, status = 500, details?: unknown) =>
  json({ ok: false, error, ...(details ? { details } : {}) }, status);

const BodySchema = z.object({
  device_identifier: z.string().trim().min(1).max(128),
  photo_base64: z.string().min(1),
  gps: z
    .object({
      lat: z.number().min(-90).max(90).optional().nullable(),
      lng: z.number().min(-180).max(180).optional().nullable(),
      accuracy: z.number().min(0).optional().nullable(),
    })
    .optional()
    .nullable(),
  captured_at: z.string().datetime(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid request body", 400, parsed.error.flatten());

    const { device_identifier, photo_base64, gps, captured_at } = parsed.data;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: device, error: deviceError } = await serviceClient
      .from("devices")
      .select("id, company_id, site_id, pairing_status, status")
      .eq("device_identifier", device_identifier)
      .maybeSingle();

    if (deviceError) {
      console.error("device-incident-photo device lookup error:", deviceError);
      return fail("Device lookup failed", 500, {
        code: deviceError.code,
        message: deviceError.message,
        details: deviceError.details,
        hint: deviceError.hint,
      });
    }
    if (!device) return fail("Device not registered", 404);
    if (device.pairing_status !== "paired") return fail("Device not paired", 403);
    if (["blocked", "wiped", "retired"].includes(device.status)) return fail("Device is not active", 403);

    let bytes: Uint8Array;
    try {
      const normalizedPhoto = photo_base64.includes(",") ? photo_base64.split(",").pop() || "" : photo_base64;
      const binary = atob(normalizedPhoto.replace(/\s/g, ""));
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      return fail("Invalid photo encoding", 400);
    }

    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      return fail("Invalid JPEG photo", 400, { size: bytes.length });
    }

    const storagePath = `${device.company_id}/${device_identifier}/${Date.now()}.jpg`;
    const { error: uploadError } = await serviceClient.storage
      .from("incident-reports")
      .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: false });

    if (uploadError) {
      console.error("device-incident-photo upload error:", uploadError);
      return fail("Failed to upload photo", 500, { message: uploadError.message });
    }

    const { data: photo, error: insertError } = await serviceClient
      .from("incident_report_photos")
      .insert({
        company_id: device.company_id,
        site_id: device.site_id,
        device_identifier,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        gps_accuracy: gps?.accuracy ?? null,
        captured_at,
        storage_path: storagePath,
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("device-incident-photo insert error:", insertError);
      return fail("Failed to record incident photo", 500, {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
      });
    }

    console.info("[IncidentPhoto] recorded", { photoId: photo?.id ?? null, companyId: device.company_id, siteId: device.site_id, bytes: bytes.length });
    return json({ ok: true, photo }, 200);
  } catch (err) {
    console.error("device-incident-photo unexpected error:", err);
    return fail((err as Error)?.message || "Internal server error", 500);
  }
});


