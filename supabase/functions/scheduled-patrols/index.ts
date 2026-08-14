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

const ok = (result: Record<string, unknown> = {}) => json({ ok: true, ...result }, 200);
const fail = (error: string, status = 200, details?: unknown) =>
  json({ ok: false, error, ...(details ? { details } : {}) }, status);

const emptyToNull = (value: unknown) => value === "" ? null : value;
const optionalUuid = z.preprocess(emptyToNull, z.string().uuid().optional().nullable());
const optionalText = z.preprocess(emptyToNull, z.string().trim().optional().nullable());

const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: optionalText,
  site_id: optionalUuid,
  status: z.enum(["active", "paused", "archived"]).optional(),
  expected_duration_minutes: z.number().int().positive().max(1440).optional(),
});

const RouteSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: optionalText,
  site_id: optionalUuid,
  template_id: optionalUuid,
  status: z.enum(["active", "paused", "archived"]).optional(),
  checkpoints: z
    .array(
      z.object({
        checkpoint_id: z.string().uuid(),
        sequence_order: z.number().int().positive().optional(),
        expected_offset_minutes: z.number().int().min(0).optional().nullable(),
        is_required: z.boolean().optional(),
      })
    )
    .min(1)
    .optional(),
});

const ScheduleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  site_id: optionalUuid,
  template_id: optionalUuid,
  route_id: z.string().uuid(),
  description: optionalText,
  frequency_type: z.enum(["once", "hourly", "daily", "weekdays", "weekends", "weekly", "custom", "every_n_minutes", "every_n_hours"]).optional(),
  interval_value: z.number().int().positive().max(10080).optional(),
  start_time: optionalText,
  end_time: optionalText,
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  next_run_at: z.preprocess(emptyToNull, z.string().datetime().optional().nullable()),
  active_from: z.preprocess(emptyToNull, z.string().datetime().optional().nullable()),
  active_until: z.preprocess(emptyToNull, z.string().datetime().optional().nullable()),
  grace_start_minutes: z.number().int().min(0).max(240).optional(),
  grace_completion_minutes: z.number().int().min(1).max(1440).optional(),
  expected_duration_minutes: z.number().int().min(1).max(1440).optional(),
  device_identifier: optionalText,
});

const TemplateUpdateSchema = TemplateSchema.partial();
const RouteUpdateSchema = RouteSchema.partial();
const ScheduleUpdateSchema = ScheduleSchema.partial();

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({ action: z.literal("create_template"), template: TemplateSchema }),
  z.object({ action: z.literal("create_route"), route: RouteSchema }),
  z.object({ action: z.literal("create_schedule"), schedule: ScheduleSchema }),
  z.object({ action: z.literal("generate_sessions"), until: z.string().datetime().optional() }),
  z.object({ action: z.literal("archive_template"), id: z.string().uuid() }),
  z.object({ action: z.literal("archive_route"), id: z.string().uuid() }),
  z.object({ action: z.literal("archive_schedule"), id: z.string().uuid() }),
  z.object({ action: z.literal("update_template"), id: z.string().uuid(), template: TemplateUpdateSchema }),
  z.object({ action: z.literal("update_route"), id: z.string().uuid(), route: RouteUpdateSchema }),
  z.object({ action: z.literal("update_schedule"), id: z.string().uuid(), schedule: ScheduleUpdateSchema }),
  z.object({ action: z.literal("delete_template"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_route"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_schedule"), id: z.string().uuid() }),
]);


type ServiceClient = ReturnType<typeof createClient>;

type Access = {
  userId: string;
  companyId: string;
  role: string | null;
};

async function requireCompanyAccess(req: Request, serviceClient: ServiceClient): Promise<Access | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail("Authentication required", 401);

  const { data: userData, error: userError } = await serviceClient.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return fail("Invalid session", 401);

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.company_id) return fail("User is not assigned to a company", 403);

  const { data: roleRow, error: roleError } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "supervisor"])
    .limit(1)
    .maybeSingle();
  if (roleError) throw roleError;
  if (!roleRow) return fail("Admin or supervisor access required", 403);

  return { userId, companyId: profile.company_id, role: roleRow.role ?? null };
}

function isResponse(value: Access | Response): value is Response {
  return value instanceof Response;
}

function removeEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

async function assertSiteBelongsToCompany(serviceClient: ServiceClient, siteId: string | null | undefined, companyId: string) {
  if (!siteId) return;
  const { data, error } = await serviceClient
    .from("sites")
    .select("id")
    .eq("id", siteId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Selected site does not belong to this company");
}

async function assertRouteBelongsToCompany(serviceClient: ServiceClient, routeId: string, companyId: string) {
  const { data, error } = await serviceClient
    .from("patrol_routes")
    .select("id, site_id, template_id")
    .eq("id", routeId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Selected route does not belong to this company");
  return data as { id: string; site_id: string | null; template_id: string | null };
}

async function assertTemplateBelongsToCompany(serviceClient: ServiceClient, templateId: string | null | undefined, companyId: string) {
  if (!templateId) return;
  const { data, error } = await serviceClient
    .from("patrol_templates")
    .select("id")
    .eq("id", templateId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Selected template does not belong to this company");
}

async function assertDeviceBelongsToCompany(serviceClient: ServiceClient, deviceIdentifier: string | null | undefined, companyId: string) {
  if (!deviceIdentifier) return;
  const { data, error } = await serviceClient
    .from("devices")
    .select("id")
    .eq("device_identifier", deviceIdentifier)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Selected device is not registered to this company");
}

class RecordNotFoundError extends Error {
  status = 404;
}

async function assertOwnedRecord(serviceClient: ServiceClient, table: string, id: string, companyId: string, label: string) {
  const { data, error } = await serviceClient
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RecordNotFoundError(`${label} no longer exists (it may have been deleted). Refresh and try again.`);
}

async function assertCheckpointsBelongToCompanyAndSite(serviceClient: ServiceClient, checkpointIds: string[], companyId: string, siteId: string | null | undefined) {
  if (!checkpointIds.length) return;

  let query = serviceClient
    .from("checkpoints")
    .select("id")
    .eq("company_id", companyId)
    .in("id", checkpointIds);
  if (siteId) query = query.eq("site_id", siteId);
  const { data, error } = await query;
  if (error) throw error;
  const found = new Set((data ?? []).map((row: any) => row.id));
  const missing = checkpointIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(siteId ? "One or more checkpoints do not belong to the selected site" : "One or more checkpoints do not belong to this company");
  }
}

async function listAll(serviceClient: ServiceClient, companyId: string) {
  const [templates, routes, schedules, sessions] = await Promise.all([
    serviceClient.from("patrol_templates").select("*, sites(name), patrol_routes(id, name)").eq("company_id", companyId).order("created_at", { ascending: false }),
    serviceClient.from("patrol_routes").select("*, sites(name), patrol_route_checkpoints(id, sequence_order, checkpoint_id, expected_offset_minutes, is_required, checkpoints(id, name, nfc_tag_id))").eq("company_id", companyId).order("created_at", { ascending: false }),
    serviceClient.from("patrol_schedules").select("*, sites(name), patrol_templates(id, name), patrol_routes(id, name)").eq("company_id", companyId).order("next_run_at", { ascending: true }),
    serviceClient.from("patrol_sessions").select("*, sites(name), patrol_templates(id, name), patrol_routes(id, name), patrol_schedules(id, name), patrol_session_checkpoints(id, checkpoint_id, scheduled_order, scanned_at, status, checkpoints(id, name, nfc_tag_id))").eq("company_id", companyId).order("scheduled_start", { ascending: false }).limit(100),
  ]);

  for (const response of [templates, routes, schedules, sessions]) {
    if (response.error) throw response.error;
  }

  return {
    templates: templates.data ?? [],
    routes: routes.data ?? [],
    schedules: schedules.data ?? [],
    sessions: sessions.data ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const access = await requireCompanyAccess(req, serviceClient);
    if (isResponse(access)) return access;

    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid request body", 400, parsed.error.flatten());
    const body = parsed.data;

    if (body.action === "list") {
      return ok(await listAll(serviceClient, access.companyId));
    }

    if (body.action === "create_template") {
      const input = body.template;
      await assertSiteBelongsToCompany(serviceClient, input.site_id, access.companyId);
      const { data, error } = await serviceClient
        .from("patrol_templates")
        .insert(removeEmpty({
          company_id: access.companyId,
          site_id: input.site_id ?? null,
          name: input.name,
          description: input.description || null,
          status: input.status ?? "active",
          expected_duration_minutes: input.expected_duration_minutes ?? 60,
          created_by: access.userId,
        }))
        .select("*")
        .single();
      if (error) throw error;
      return ok({ template: data });
    }

    if (body.action === "create_route") {
      const input = body.route;
      await assertSiteBelongsToCompany(serviceClient, input.site_id, access.companyId);
      await assertTemplateBelongsToCompany(serviceClient, input.template_id, access.companyId);
      const checkpointIds = input.checkpoints?.map((checkpoint) => checkpoint.checkpoint_id) ?? [];
      await assertCheckpointsBelongToCompanyAndSite(serviceClient, checkpointIds, access.companyId, input.site_id);

      const { data: route, error: routeError } = await serviceClient
        .from("patrol_routes")
        .insert(removeEmpty({
          company_id: access.companyId,
          site_id: input.site_id ?? null,
          template_id: input.template_id ?? null,
          name: input.name,
          description: input.description || null,
          status: input.status ?? "active",
          created_by: access.userId,
        }))
        .select("*")
        .single();
      if (routeError) throw routeError;

      if (input.checkpoints?.length) {
        const rows = input.checkpoints.map((checkpoint, index) => ({
          company_id: access.companyId,
          route_id: route.id,
          checkpoint_id: checkpoint.checkpoint_id,
          sequence_order: checkpoint.sequence_order ?? index + 1,
          expected_arrival_offset_minutes: checkpoint.expected_offset_minutes ?? null,
          expected_offset_minutes: checkpoint.expected_offset_minutes ?? null,
          is_required: checkpoint.is_required ?? true,
        }));
        const { error: checkpointError } = await serviceClient.from("patrol_route_checkpoints").insert(rows);
        if (checkpointError) {
          // Keep route creation atomic: a route must never survive without its checkpoint sequence.
          await serviceClient.from("patrol_routes").delete().eq("id", route.id).eq("company_id", access.companyId);
          throw checkpointError;
        }
      }

      return ok({ route });
    }

    if (body.action === "create_schedule") {
      const input = body.schedule;
      const route = await assertRouteBelongsToCompany(serviceClient, input.route_id, access.companyId);
      await assertSiteBelongsToCompany(serviceClient, input.site_id ?? route.site_id, access.companyId);
      await assertTemplateBelongsToCompany(serviceClient, input.template_id ?? route.template_id, access.companyId);
      await assertDeviceBelongsToCompany(serviceClient, input.device_identifier, access.companyId);

      const frequencyType = input.frequency_type ?? "daily";
      const { data, error } = await serviceClient
        .from("patrol_schedules")
        .insert(removeEmpty({
          company_id: access.companyId,
          site_id: input.site_id ?? route.site_id ?? null,
          template_id: input.template_id ?? route.template_id ?? null,
          route_id: input.route_id,
          name: input.name,
          description: input.description || null,
          frequency: frequencyType,
          frequency_type: frequencyType,
          interval_value: input.interval_value ?? 1,
          start_time: input.start_time || null,
          end_time: input.end_time || null,
          days_of_week: input.days_of_week ?? [],
          timezone: input.timezone ?? "Africa/Gaborone",
          status: input.status ?? "active",
          next_run_at: input.next_run_at ?? input.active_from ?? new Date().toISOString(),
          active_from: input.active_from ?? new Date().toISOString(),
          active_until: input.active_until ?? null,
          grace_start_minutes: input.grace_start_minutes ?? 10,
          grace_completion_minutes: input.grace_completion_minutes ?? input.expected_duration_minutes ?? 40,
          expected_duration_minutes: input.expected_duration_minutes ?? input.grace_completion_minutes ?? 40,
          device_identifier: input.device_identifier || null,
          created_by: access.userId,
        }))
        .select("*")
        .single();
      if (error) throw error;
      return ok({ schedule: data });
    }

    if (body.action === "generate_sessions") {
      const until = body.until ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data: generated, error: generateError } = await serviceClient.rpc("generate_due_patrol_sessions", { p_until: until });
      if (generateError) throw generateError;
      const { data: advanced, error: advanceError } = await serviceClient.rpc("advance_due_patrol_session_statuses");
      if (advanceError) throw advanceError;
      return ok({ generated: generated ?? 0, advanced: advanced ?? 0 });
    }

    const archiveMap = {
      archive_template: "patrol_templates",
      archive_route: "patrol_routes",
      archive_schedule: "patrol_schedules",
    } as const;
    if (body.action === "archive_template" || body.action === "archive_route" || body.action === "archive_schedule") {
      const table = archiveMap[body.action];
      const recordId = body.id;
      const { data, error } = await serviceClient
        .from(table)
        .update({ status: "archived" })
        .eq("id", recordId)
        .eq("company_id", access.companyId)
        .select("*")
        .single();
      if (error) throw error;
      return ok({ record: data });
    }

    if (body.action === "update_template") {
      const input = body.template;
      await assertOwnedRecord(serviceClient, "patrol_templates", body.id, access.companyId, "Patrol template");
      await assertSiteBelongsToCompany(serviceClient, input.site_id, access.companyId);
      const { data, error } = await serviceClient
        .from("patrol_templates")
        .update(removeEmpty({
          name: input.name,
          description: input.description === undefined ? undefined : (input.description || null),
          site_id: input.site_id === undefined ? undefined : (input.site_id ?? null),
          status: input.status,
          expected_duration_minutes: input.expected_duration_minutes,
        }))
        .eq("id", body.id)
        .eq("company_id", access.companyId)
        .select("*")
        .single();
      if (error) throw error;
      return ok({ template: data });
    }

    if (body.action === "update_route") {
      const input = body.route;
      await assertOwnedRecord(serviceClient, "patrol_routes", body.id, access.companyId, "Patrol route");
      await assertSiteBelongsToCompany(serviceClient, input.site_id, access.companyId);
      await assertTemplateBelongsToCompany(serviceClient, input.template_id, access.companyId);

      if (input.checkpoints?.length) {
        await assertCheckpointsBelongToCompanyAndSite(
          serviceClient,
          input.checkpoints.map((checkpoint) => checkpoint.checkpoint_id),
          access.companyId,
          input.site_id,
        );
      }

      const { data, error } = await serviceClient
        .from("patrol_routes")
        .update(removeEmpty({
          name: input.name,
          description: input.description === undefined ? undefined : (input.description || null),
          site_id: input.site_id === undefined ? undefined : (input.site_id ?? null),
          template_id: input.template_id === undefined ? undefined : (input.template_id ?? null),
          status: input.status,
        }))
        .eq("id", body.id)
        .eq("company_id", access.companyId)
        .select("*")
        .single();
      if (error) throw error;

      if (input.checkpoints?.length) {
        const { error: deleteError } = await serviceClient
          .from("patrol_route_checkpoints")
          .delete()
          .eq("route_id", body.id)
          .eq("company_id", access.companyId);
        if (deleteError) throw deleteError;

        const rows = input.checkpoints.map((checkpoint, index) => ({
          company_id: access.companyId,
          route_id: body.id,
          checkpoint_id: checkpoint.checkpoint_id,
          sequence_order: checkpoint.sequence_order ?? index + 1,
          expected_arrival_offset_minutes: checkpoint.expected_offset_minutes ?? null,
          expected_offset_minutes: checkpoint.expected_offset_minutes ?? null,
          is_required: checkpoint.is_required ?? true,
        }));
        const { error: insertError } = await serviceClient.from("patrol_route_checkpoints").insert(rows);
        if (insertError) throw insertError;
      }

      return ok({ route: data });
    }

    if (body.action === "update_schedule") {
      const input = body.schedule;
      await assertOwnedRecord(serviceClient, "patrol_schedules", body.id, access.companyId, "Patrol schedule");
      if (input.route_id) await assertRouteBelongsToCompany(serviceClient, input.route_id, access.companyId);
      await assertSiteBelongsToCompany(serviceClient, input.site_id, access.companyId);
      await assertTemplateBelongsToCompany(serviceClient, input.template_id, access.companyId);
      await assertDeviceBelongsToCompany(serviceClient, input.device_identifier, access.companyId);

      const { data, error } = await serviceClient
        .from("patrol_schedules")
        .update(removeEmpty({
          name: input.name,
          route_id: input.route_id,
          site_id: input.site_id === undefined ? undefined : (input.site_id ?? null),
          template_id: input.template_id === undefined ? undefined : (input.template_id ?? null),
          frequency: input.frequency_type,
          frequency_type: input.frequency_type,
          interval_value: input.interval_value,
          start_time: input.start_time === undefined ? undefined : (input.start_time || null),
          end_time: input.end_time === undefined ? undefined : (input.end_time || null),
          days_of_week: input.days_of_week,
          timezone: input.timezone,
          status: input.status,
          grace_start_minutes: input.grace_start_minutes,
          grace_completion_minutes: input.grace_completion_minutes,
          device_identifier: input.device_identifier === undefined ? undefined : (input.device_identifier || null),
        }))
        .eq("id", body.id)
        .eq("company_id", access.companyId)
        .select("*")
        .single();
      if (error) throw error;
      return ok({ schedule: data });
    }

    if (body.action === "delete_template") {
      await assertOwnedRecord(serviceClient, "patrol_templates", body.id, access.companyId, "Patrol template");
      for (const table of ["patrol_routes", "patrol_schedules", "patrol_sessions"] as const) {
        const { error } = await serviceClient
          .from(table)
          .update({ template_id: null })
          .eq("template_id", body.id)
          .eq("company_id", access.companyId);
        if (error) throw error;
      }
      const { error: deleteError } = await serviceClient
        .from("patrol_templates")
        .delete()
        .eq("id", body.id)
        .eq("company_id", access.companyId);
      if (deleteError) throw deleteError;
      return ok({ deleted: body.id });
    }

    if (body.action === "delete_route") {
      await assertOwnedRecord(serviceClient, "patrol_routes", body.id, access.companyId, "Patrol route");

      const { count: scheduleCount, error: scheduleError } = await serviceClient
        .from("patrol_schedules")
        .select("id", { count: "exact", head: true })
        .eq("route_id", body.id)
        .eq("company_id", access.companyId);
      if (scheduleError) throw scheduleError;
      if (scheduleCount) return fail("This route is still used by a schedule. Delete or repoint the schedule first, or archive the route instead.");

      const { count: sessionCount, error: sessionError } = await serviceClient
        .from("patrol_sessions")
        .select("id", { count: "exact", head: true })
        .eq("route_id", body.id)
        .eq("company_id", access.companyId);
      if (sessionError) throw sessionError;
      if (sessionCount) return fail("This route already has patrol sessions in history. Archive it instead of deleting.");

      const { error: checkpointError } = await serviceClient
        .from("patrol_route_checkpoints")
        .delete()
        .eq("route_id", body.id)
        .eq("company_id", access.companyId);
      if (checkpointError) throw checkpointError;

      const { error: deleteError } = await serviceClient
        .from("patrol_routes")
        .delete()
        .eq("id", body.id)
        .eq("company_id", access.companyId);
      if (deleteError) throw deleteError;
      return ok({ deleted: body.id });
    }

    if (body.action === "delete_schedule") {
      await assertOwnedRecord(serviceClient, "patrol_schedules", body.id, access.companyId, "Patrol schedule");

      const { data: sessions, error: sessionError } = await serviceClient
        .from("patrol_sessions")
        .select("id, status")
        .eq("schedule_id", body.id)
        .eq("company_id", access.companyId);
      if (sessionError) throw sessionError;

      const pendingIds = (sessions ?? [])
        .filter((row: any) => ["scheduled", "awaiting_start"].includes(row.status))
        .map((row: any) => row.id);

      if (pendingIds.length) {
        const { error: checkpointError } = await serviceClient
          .from("patrol_session_checkpoints")
          .delete()
          .in("session_id", pendingIds)
          .eq("company_id", access.companyId);
        if (checkpointError) throw checkpointError;
        const { error: pendingError } = await serviceClient
          .from("patrol_sessions")
          .delete()
          .in("id", pendingIds)
          .eq("company_id", access.companyId);
        if (pendingError) throw pendingError;
      }

      const { error: detachError } = await serviceClient
        .from("patrol_sessions")
        .update({ schedule_id: null })
        .eq("schedule_id", body.id)
        .eq("company_id", access.companyId);
      if (detachError) throw detachError;

      const { error: deleteError } = await serviceClient
        .from("patrol_schedules")
        .delete()
        .eq("id", body.id)
        .eq("company_id", access.companyId);
      if (deleteError) throw deleteError;
      return ok({ deleted: body.id, removed_pending_sessions: pendingIds.length });
    }

    return fail("Unknown action", 400);

  } catch (err) {
    console.error("scheduled-patrols error:", err);
    return fail((err as Error)?.message || "Internal server error", 500, {
      code: (err as any)?.code ?? null,
      message: (err as any)?.message ?? null,
      details: (err as any)?.details ?? null,
      hint: (err as any)?.hint ?? null,
    });
  }
});
