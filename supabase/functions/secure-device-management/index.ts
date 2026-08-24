import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import {
  getSecureDeviceByIdentifier,
  getSecureDeviceEvents,
  getSecureDeviceSummary,
  requestSecureDeviceCommand,
  type SecureDeviceAction,
  type SecureDeviceActor,
} from "../_shared/secure-device-management.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  action?: SecureDeviceAction;
  site_id?: string | null;
  device_identifier?: string | null;
  payload?: Record<string, unknown>;
  channel?: string;
};

const commandActions = new Set<string>([
  "request_device_lock",
  "request_device_disable",
  "request_device_enable",
  "request_maintenance_mode",
  "request_exit_maintenance",
  "request_app_update",
  "request_integrity_check",
  "revoke_device",
]);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveActor(req: Request): Promise<{ service: ReturnType<typeof createClient>; actor: SecureDeviceActor }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) throw new Error("Authentication required");

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) throw new Error("Authentication required");

  const service = createClient(supabaseUrl, serviceKey);
  const userId = userData.user.id;
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError || !profile?.company_id) throw new Error("Company profile required");

  const { data: role } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("company_id", profile.company_id)
    .maybeSingle();

  const roleName = String(role?.role ?? "guard");
  const canManage = roleName === "admin" || roleName === "supervisor";
  return { service, actor: { company_id: profile.company_id, user_id: userId, role: roleName, canManage, allowed_site_ids: [] } };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Body;
    const action = body.action ?? "get_secure_device_summary";
    const { service, actor } = await resolveActor(req);
    const siteId = body.site_id ?? null;

    if (action === "get_secure_device_summary" || action === "get_device_security_status") {
      return json({ success: true, summary: await getSecureDeviceSummary(service, actor, siteId) });
    }

    if (action === "get_device_security_details") {
      if (!body.device_identifier) return json({ error: "device_identifier is required" }, 400);
      const device = await getSecureDeviceByIdentifier(service, actor, siteId, body.device_identifier);
      if (!device) return json({ error: "Device not found for active site" }, 404);
      return json({ success: true, device, events: await getSecureDeviceEvents(service, actor, siteId, String(device.id)) });
    }

    if (action === "get_device_security_events") {
      return json({ success: true, events: await getSecureDeviceEvents(service, actor, siteId) });
    }

    if (commandActions.has(action)) {
      if (!body.device_identifier) return json({ error: "device_identifier is required" }, 400);
      const result = await requestSecureDeviceCommand(service, actor, siteId, action, body.device_identifier, body.payload ?? {}, body.channel ?? "web");
      return json({ success: true, result });
    }

    return json({ error: "Unsupported secure device action" }, 400);
  } catch (error) {
    const raw = (error ?? {}) as Record<string, unknown>;
    const message = String(raw.message ?? "Secure device request failed");
    const code = raw.code ? String(raw.code) : null;
    const details = raw.details ? String(raw.details) : null;
    const hint = raw.hint ? String(raw.hint) : null;
    const status = /access|required|auth/i.test(message) && !code ? 403 : 500;
    console.error("[secure-device-management]", JSON.stringify({ message, code, details, hint }));
    return json({
      error: code ? message + " (" + code + ")" : message,
      db_error: { message, code, details, hint },
    }, status);
  }
});