import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { ManagementActionError, runManagementAction, type ManagementActor } from "../_shared/management-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function resolveActor(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) throw new ManagementActionError("Authentication required", 401);

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user) throw new ManagementActionError("Authentication required", 401);

  const service = createClient(supabaseUrl, serviceKey);
  const userId = userData.user.id;

  const { data: profile } = await service.from("profiles").select("company_id").eq("id", userId).maybeSingle();
  if (!profile?.company_id) throw new ManagementActionError("Company profile required", 403);

  const { data: roleRow } = await service.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  const role = String(roleRow?.role ?? "guard");

  const { data: guard } = await service
    .from("guards")
    .select("id")
    .eq("company_id", profile.company_id)
    .eq("user_id", userId)
    .maybeSingle();

  const actor: ManagementActor = {
    company_id: profile.company_id,
    user_id: userId,
    guard_id: guard?.id ?? null,
    role,
    canManage: role === "admin" || role === "supervisor",
    allowed_site_ids: [],
  };
  return { service, actor };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as { action?: string; input?: Record<string, unknown> };
    if (!body.action) return json({ error: "action is required" }, 400);
    const { service, actor } = await resolveActor(req);
    const result = await runManagementAction(service, actor, body.action, body.input ?? {});
    return json(result);
  } catch (error) {
    const status = error instanceof ManagementActionError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Management action failed";
    console.error("[management-actions]", status, message);
    return json({ error: message }, status);
  }
});
