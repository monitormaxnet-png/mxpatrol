import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { processTtechFaceJpeg } from "../_shared/ttechImageProcessing.ts";
import { identifyTtechFace, type TtechFaceTemplate } from "../_shared/ttechNativeBiometrics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const fail = (error: string, status = 500, details?: unknown) => json({ ok: false, error, ...(details ? { details } : {}) }, status);

const BodySchema = z.object({
  device_identifier: z.string().trim().min(1).max(128),
  event_type: z.enum(["clock_in", "clock_out"]),
  face_photo_base64: z.string().min(1),
  captured_at: z.string().datetime(),
  idempotency_key: z.string().trim().min(8).max(160),
  source_event_id: z.string().trim().min(1).max(160).optional(),
  is_offline_sync: z.boolean().optional().default(false),
  biometric_test_mode: z.boolean().optional().default(false),
  test_session_id: z.string().trim().min(1).max(160).optional().nullable(),
  gps: z.object({
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
    accuracy: z.number().min(0).optional().nullable(),
  }).optional().nullable(),
});

type ProviderResult = {
  status: "provider_unconfigured" | "verified" | "unmatched" | "ambiguous" | "poor_quality" | "spoof_suspected" | "review_required";
  guardId?: string | null;
  providerName?: string | null;
  providerReference?: string | null;
  candidateSummary?: unknown[];
  livenessResult?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

async function identifyFace(input: { service: any; companyId: string; siteId: string | null; storagePath: string; facePhotoBase64: string }): Promise<ProviderResult> {
  const provider = Deno.env.get("MXPATROL_BIOMETRIC_PROVIDER")?.trim().toLowerCase();
  if (!provider) {
    return {
      status: "provider_unconfigured",
      providerName: null,
      candidateSummary: [],
      livenessResult: { status: "not_checked", reason: "No dedicated biometric provider configured" },
      raw: { setup_required: true },
    };
  }
  if (provider === "ttech_native") {
    const startedAt = performance.now();
    let processed;
    try {
      processed = processTtechFaceJpeg(input.facePhotoBase64);
    } catch (error) {
      return {
        status: "poor_quality",
        providerName: "ttech_native",
        candidateSummary: [],
        livenessResult: { status: "not_checked", reason: "Image decoding or preprocessing failed" },
        raw: { engine: "ttech_native", processing_duration_ms: Math.round(performance.now() - startedAt), accepted: false, error: error instanceof Error ? error.message : "processing_failed" },
      };
    }
    if (!processed.vector || processed.quality.status !== "passed" || processed.candidates.length !== 1) {
      return {
        status: "poor_quality",
        providerName: "ttech_native",
        candidateSummary: [],
        livenessResult: processed.liveness as unknown as Record<string, unknown>,
        raw: { engine: processed.engineVersion, processing_duration_ms: Math.round(performance.now() - startedAt), accepted: false, quality: processed.quality, candidate_count: processed.candidates.length },
      };
    }

    const { data: rows, error } = await input.service
      .from("ttech_biometric_template_secrets")
      .select("id, guard_id, company_id, site_id, vector, status, engine_version")
      .eq("company_id", input.companyId)
      .eq("status", "active");
    if (error) throw error;

    const templates: TtechFaceTemplate[] = (rows ?? []).map((row: any) => ({
      id: String(row.id),
      guardId: String(row.guard_id),
      companyId: String(row.company_id),
      siteIds: row.site_id ? [String(row.site_id)] : null,
      status: "active",
      version: 1,
      vector: Array.isArray(row.vector) ? row.vector.map(Number) : [],
    })).filter((template) => template.vector.length === processed.vector!.length);

    const match = identifyTtechFace({ vector: processed.vector, templates, companyId: input.companyId, siteId: input.siteId });
    const status = match.status === "matched" ? "review_required" : match.status === "no_templates" ? "review_required" : match.status;
    return {
      status,
      guardId: match.status === "matched" ? match.guardId : null,
      providerName: "ttech_native",
      providerReference: match.templateId,
      candidateSummary: match.candidates,
      livenessResult: processed.liveness as unknown as Record<string, unknown>,
      raw: {
        engine: processed.engineVersion,
        accepted: false,
        reason: "TTECH native research engine produced candidates, but automatic verification remains disabled pending real-world validation",
        processing_duration_ms: Math.round(performance.now() - startedAt),
        match,
        quality: processed.quality,
        face: processed.face,
        evidence_path: input.storagePath,
      },
    };
  }
  if (provider === "mock" && Deno.env.get("MXPATROL_ALLOW_MOCK_BIOMETRICS") === "true") {
    return {
      status: "review_required",
      providerName: "mock",
      candidateSummary: [],
      livenessResult: { status: "not_supported" },
      raw: { mock: true, accepted: false, reason: "Mock provider never auto-verifies attendance" },
    };
  }
  return {
    status: "provider_unconfigured",
    providerName: provider,
    candidateSummary: [],
    livenessResult: { status: "not_checked", reason: "Configured provider adapter is not implemented" },
    raw: { setup_required: true, provider },
  };
}

function topCandidate(result: ProviderResult): any | null {
  const candidates = Array.isArray(result.candidateSummary) ? result.candidateSummary as any[] : [];
  return candidates[0] ?? null;
}

function phase3Outcome(status: ProviderResult["status"], guardId?: string | null) {
  if (status === "review_required" && guardId) return "match_candidate";
  if (status === "unmatched") return "no_match";
  if (status === "ambiguous") return "ambiguous";
  if (status === "poor_quality") return "poor_quality";
  if (status === "provider_unconfigured") return "provider_unconfigured";
  return "review_required";
}

function decodeBase64Image(value: string): Uint8Array | null {
  try {
    const normalized = value.includes(",") ? value.split(",").pop() || "" : value;
    const binary = atob(normalized.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("Invalid request body", 400, parsed.error.flatten());
    const body = parsed.data;

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: device, error: deviceError } = await service
      .from("devices")
      .select("id, company_id, site_id, device_identifier, pairing_status, status")
      .eq("device_identifier", body.device_identifier)
      .maybeSingle();
    if (deviceError) return fail("Device lookup failed", 500, deviceError);
    if (!device) return fail("Device not registered", 404);
    if (device.pairing_status !== "paired") return fail("Device not paired", 403);
    if (["blocked", "wiped", "retired", "disabled"].includes(String(device.status ?? ""))) return fail("Device is not active", 403);

    const { data: existing, error: existingError } = await service
      .from("attendance_events")
      .select("id, verification_status, review_status, guard_id, photo_reference, provider_result")
      .eq("company_id", device.company_id)
      .eq("idempotency_key", body.idempotency_key)
      .maybeSingle();
    if (existingError) return fail("Idempotency lookup failed", 500, existingError);
    if (existing) return json({ ok: true, duplicate: true, event: existing, verification_status: existing.verification_status, review_status: existing.review_status });

    const bytes = decodeBase64Image(body.face_photo_base64);
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      return fail("Invalid JPEG face photo", 400, { size: bytes?.length ?? 0 });
    }

    const storagePath = `${device.company_id}/${device.device_identifier}/attendance/${Date.now()}-${body.idempotency_key.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80)}.jpg`;
    const { error: uploadError } = await service.storage.from("attendance-evidence").upload(storagePath, bytes, { contentType: "image/jpeg", upsert: false });
    if (uploadError) return fail("Failed to upload attendance evidence", 500, { message: uploadError.message });

    const result = await identifyFace({ service, companyId: device.company_id, siteId: device.site_id, storagePath, facePhotoBase64: body.face_photo_base64 });
    const reviewStatus = result.status === "verified" ? "not_required" : "pending";

    const { data: event, error: insertError } = await service.from("attendance_events").insert({
      company_id: device.company_id,
      site_id: device.site_id,
      device_id: device.id,
      device_identifier: device.device_identifier,
      event_type: body.event_type,
      verification_status: result.status,
      captured_at: body.captured_at,
      latitude: body.gps?.lat ?? null,
      longitude: body.gps?.lng ?? null,
      gps_accuracy: body.gps?.accuracy ?? null,
      photo_reference: storagePath,
      provider_name: result.providerName ?? null,
      biometric_provider_reference: result.providerReference ?? null,
      provider_result: result.raw ?? {},
      candidate_summary: result.candidateSummary ?? [],
      liveness_result: result.livenessResult ?? {},
      guard_id: result.guardId ?? null,
      review_status: reviewStatus,
      offline_sync_status: body.is_offline_sync ? "synced" : "online",
      idempotency_key: body.idempotency_key,
      source_event_id: body.source_event_id ?? null,
      notes: result.status === "provider_unconfigured" ? "Dedicated biometric provider is not configured; attendance requires supervisor review." : null,
    }).select("*").single();
    if (insertError) return fail("Failed to record attendance event", 500, insertError);

    if (body.biometric_test_mode) {
      const candidate = topCandidate(result);
      const second = Array.isArray(result.candidateSummary) ? (result.candidateSummary as any[])[1] : null;
      const similarity = typeof candidate?.similarity === "number" ? candidate.similarity : typeof candidate?.score === "number" ? candidate.score : null;
      const secondSimilarity = typeof second?.similarity === "number" ? second.similarity : typeof second?.score === "number" ? second.score : null;
      const processingDurationMs = typeof result.raw?.processing_duration_ms === "number" ? result.raw.processing_duration_ms : null;
      const { error: testInsertError } = await service.from("biometric_test_captures").insert({
        company_id: device.company_id,
        site_id: device.site_id,
        device_id: device.id,
        device_identifier: device.device_identifier,
        attendance_event_id: event.id,
        test_capture_identifier: body.source_event_id ?? body.idempotency_key,
        test_session_id: body.test_session_id ?? null,
        testing_mode: body.is_offline_sync ? "offline_sync" : "rg360_volume_up",
        candidate_guard_id: result.guardId ?? null,
        similarity_score: similarity,
        candidate_margin: similarity != null && secondSimilarity != null ? similarity - secondSimilarity : null,
        candidate_count: Array.isArray(result.candidateSummary) ? result.candidateSummary.length : 0,
        image_quality_status: String((result.raw?.quality as any)?.status ?? result.status),
        image_quality: result.raw?.quality ?? {},
        liveness_status: String(result.livenessResult?.status ?? "not_validated"),
        liveness_result: result.livenessResult ?? {},
        outcome_status: phase3Outcome(result.status, result.guardId),
        device_model: "RG360",
        processing_duration_ms: processingDurationMs,
        captured_at: body.captured_at,
        metadata: {
          provider_name: result.providerName,
          provider_reference: result.providerReference,
          automatic_verification_disabled: true,
          liveness_limitation: "Still-photo liveness heuristic is unvalidated and must not be treated as reliable.",
        },
      });
      if (testInsertError) console.error("Failed to record biometric test capture", testInsertError);
    }


    return json({ ok: true, event, verification_status: result.status, review_status: reviewStatus, setup_required: result.status === "provider_unconfigured" });
  } catch (error) {
    console.error("device-attendance unexpected error", error);
    return fail((error as Error)?.message || "Internal server error", 500);
  }
});
