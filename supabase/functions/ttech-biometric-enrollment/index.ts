import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { processTtechFaceJpeg } from "../_shared/ttechImageProcessing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const fail = (error: string, status = 500, details?: unknown) => json({ ok: false, error, ...(details ? { details } : {}) }, status);

const SampleSchema = z.object({ face_photo_base64: z.string().min(1), captured_at: z.string().datetime().optional() });
const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll"), guard_id: z.string().uuid(), site_id: z.string().uuid().optional().nullable(), samples: z.array(SampleSchema).min(2).max(6), privacy_notice_version: z.string().max(80).optional(), lawful_basis: z.string().max(160).optional(), retention_policy: z.string().max(160).optional() }),
  z.object({ action: z.literal("revoke"), enrollment_id: z.string().uuid(), reason: z.string().max(240).optional() }),
  z.object({ action: z.literal("status"), guard_id: z.string().uuid().optional() }),
]);

async function resolveActor(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) throw new Error("Authentication required");
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user) throw new Error("Authentication required");
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userId = userData.user.id;
  const { data: profile } = await service.from("profiles").select("company_id").eq("id", userId).maybeSingle();
  const { data: platformAdmin } = await service.from("platform_admins").select("role").eq("user_id", userId).maybeSingle();
  const isPlatformOwner = platformAdmin?.role === "owner";
  const { data: roleRow } = await service.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  const role = String(roleRow?.role ?? (isPlatformOwner ? "admin" : "guard"));
  const canManage = isPlatformOwner || role === "admin" || role === "supervisor";
  if (!canManage) throw new Error("Management access required");
  if (!profile?.company_id && !isPlatformOwner) throw new Error("Company profile required");
  return { service, userId, companyId: profile?.company_id ?? null, isPlatformOwner };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  try {
    const actor = await resolveActor(req);
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("Invalid request body", 400, parsed.error.flatten());
    const body = parsed.data;
    if (body.action === "enroll") return await enroll(actor, body);
    if (body.action === "revoke") return await revoke(actor, body);
    return await status(actor, body.guard_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enrollment request failed";
    const status = message.includes("Authentication") ? 401 : message.includes("access") || message.includes("profile") ? 403 : 500;
    console.error("[ttech-biometric-enrollment]", message);
    return fail(message, status);
  }
});

async function enroll(actor: Awaited<ReturnType<typeof resolveActor>>, body: Extract<z.infer<typeof BodySchema>, { action: "enroll" }>) {
  const { service, userId, companyId, isPlatformOwner } = actor;
  const { data: guard, error: guardError } = await service.from("guards").select("id, company_id, full_name, is_active").eq("id", body.guard_id).maybeSingle();
  if (guardError) return fail("Guard lookup failed", 500, guardError);
  if (!guard) return fail("Guard not found", 404);
  if (!isPlatformOwner && guard.company_id !== companyId) return fail("Guard is outside your company", 403);
  if (!guard.is_active) return fail("Cannot enroll inactive guard", 400);

  const processed = body.samples.map((sample) => processTtechFaceJpeg(sample.face_photo_base64));
  const rejected = processed.find((item) => item.quality.status !== "passed" || !item.vector || item.candidates.length !== 1);
  if (rejected) return fail("Enrollment sample failed quality checks", 400, { quality: rejected.quality, candidate_count: rejected.candidates.length, liveness: rejected.liveness });

  const { data: enrollment, error: enrollmentError } = await service.from("guard_biometric_enrollments").insert({
    company_id: guard.company_id,
    guard_id: guard.id,
    site_id: body.site_id ?? null,
    provider_name: "ttech_native",
    template_version: 1,
    enrollment_status: "active",
    quality_status: "passed",
    liveness_status: "manual_review",
    sample_count: processed.length,
    enrolled_at: new Date().toISOString(),
    authorized_by: userId,
    privacy_notice_version: body.privacy_notice_version ?? null,
    lawful_basis: body.lawful_basis ?? null,
    retention_policy: body.retention_policy ?? null,
    metadata: { engine: processed[0]?.engineVersion, limitations: "Research engine; still-photo liveness requires supervisor review" },
  }).select("*").single();
  if (enrollmentError) return fail("Failed to create enrollment", 500, enrollmentError);

  const templateRows = processed.map((item) => ({
    enrollment_id: enrollment.id,
    company_id: guard.company_id,
    guard_id: guard.id,
    site_id: body.site_id ?? null,
    engine_version: item.engineVersion,
    template_version: 1,
    vector: item.vector,
    status: "active",
    quality: { quality: item.quality, face: item.face, liveness: item.liveness },
  }));
  const { error: templateError } = await service.from("ttech_biometric_template_secrets").insert(templateRows);
  if (templateError) return fail("Failed to store biometric templates", 500, templateError);

  await service.from("guards").update({ biometric_enrollment_status: "active", biometric_enrolled_at: enrollment.enrolled_at, biometric_template_version: 1 }).eq("id", guard.id).eq("company_id", guard.company_id);
  return json({ ok: true, enrollment: publicEnrollment(enrollment), sample_count: processed.length, status: "active" });
}

async function revoke(actor: Awaited<ReturnType<typeof resolveActor>>, body: Extract<z.infer<typeof BodySchema>, { action: "revoke" }>) {
  const { service, companyId, isPlatformOwner } = actor;
  const { data: enrollment } = await service.from("guard_biometric_enrollments").select("id, company_id, guard_id").eq("id", body.enrollment_id).maybeSingle();
  if (!enrollment) return fail("Enrollment not found", 404);
  if (!isPlatformOwner && enrollment.company_id !== companyId) return fail("Enrollment is outside your company", 403);
  const now = new Date().toISOString();
  await service.from("guard_biometric_enrollments").update({ enrollment_status: "revoked", revoked_at: now, metadata: { revoked_reason: body.reason ?? "revoked_by_admin" } }).eq("id", enrollment.id);
  await service.from("ttech_biometric_template_secrets").update({ status: "revoked", revoked_at: now }).eq("enrollment_id", enrollment.id);
  await service.from("guards").update({ biometric_enrollment_status: "revoked" }).eq("id", enrollment.guard_id).eq("company_id", enrollment.company_id);
  return json({ ok: true, revoked: true, enrollment_id: enrollment.id });
}

async function status(actor: Awaited<ReturnType<typeof resolveActor>>, guardId?: string) {
  const { service, companyId, isPlatformOwner } = actor;
  let query = service.from("guard_biometric_enrollments").select("id, company_id, guard_id, site_id, provider_name, template_version, enrollment_status, quality_status, liveness_status, sample_count, enrolled_at, revoked_at, created_at").order("created_at", { ascending: false }).limit(50);
  if (!isPlatformOwner && companyId) query = query.eq("company_id", companyId);
  if (guardId) query = query.eq("guard_id", guardId);
  const { data, error } = await query;
  if (error) return fail("Failed to load enrollment status", 500, error);
  return json({ ok: true, enrollments: (data ?? []).map(publicEnrollment) });
}

function publicEnrollment(row: Record<string, unknown>) {
  const { metadata: _metadata, ...safe } = row;
  return safe;
}
