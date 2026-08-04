import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  const ok = payload.ok === true || payload.success === true;
  const responsePayload = { success: ok, ok, ...payload };
  return new Response(JSON.stringify(responsePayload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function requirePlatformAdmin(req: Request, serviceClient: any) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, response: json(200, { ok: false, error: "Authentication required" }) };

  const { data: userData, error: userError } = await serviceClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return { ok: false as const, response: json(200, { ok: false, error: "Invalid session" }) };

  const { count, error: countError } = await serviceClient
    .from("platform_admins")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;

  if ((count ?? 0) === 0) {
    const { error: bootstrapError } = await serviceClient
      .from("platform_admins")
      .insert({ user_id: user.id, role: "owner" });
    if (bootstrapError) throw bootstrapError;
    return { ok: true as const, user, role: "owner", bootstrapped: true };
  }

  const { data: admin, error: adminError } = await serviceClient
    .from("platform_admins")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminError) throw adminError;
  if (!admin) return { ok: false as const, response: json(200, { ok: false, error: "Platform admin access required" }) };

  return { ok: true as const, user, role: admin.role, bootstrapped: false };
}

async function listCompanies(serviceClient: any) {
  const { data, error } = await serviceClient
    .from("companies")
    .select("id, name, domain, logo_url, settings, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const companyIds = (data ?? []).map((company: any) => company.id);
  const counts: Record<string, { users: number; sites: number; devices: number }> = {};
  for (const id of companyIds) counts[id] = { users: 0, sites: 0, devices: 0 };

  await Promise.all([
    companyIds.length
      ? serviceClient.from("profiles").select("company_id").in("company_id", companyIds).then(({ data, error }: any) => {
          if (error) throw error;
          for (const row of data ?? []) if (counts[row.company_id]) counts[row.company_id].users += 1;
        })
      : Promise.resolve(),
    companyIds.length
      ? serviceClient.from("sites").select("company_id").in("company_id", companyIds).then(({ data, error }: any) => {
          if (error) throw error;
          for (const row of data ?? []) if (counts[row.company_id]) counts[row.company_id].sites += 1;
        })
      : Promise.resolve(),
    companyIds.length
      ? serviceClient.from("devices").select("company_id").in("company_id", companyIds).then(({ data, error }: any) => {
          if (error) throw error;
          for (const row of data ?? []) if (counts[row.company_id]) counts[row.company_id].devices += 1;
        })
      : Promise.resolve(),
  ]);

  return (data ?? []).map((company: any) => ({
    ...company,
    status: company.settings?.status ?? "active",
    contact_name: company.settings?.contact_name ?? null,
    contact_email: company.settings?.contact_email ?? null,
    contact_phone: company.settings?.contact_phone ?? null,
    address: company.settings?.address ?? null,
    counts: counts[company.id] ?? { users: 0, sites: 0, devices: 0 },
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const access = await requirePlatformAdmin(req, serviceClient);
    if (!access.ok) return access.response;

    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const action = cleanText((body as any).action) || "list";

    if (action === "status") {
      return json(200, { ok: true, platform_admin: true, role: access.role, bootstrapped: access.bootstrapped });
    }

    if (action === "list") {
      const companies = await listCompanies(serviceClient);
      return json(200, { ok: true, companies, role: access.role, bootstrapped: access.bootstrapped });
    }

    if (action === "create") {
      const companyInput = (body as any).company ?? body;
      const settingsInput = (companyInput as any).settings ?? {};
      const adminInput = (body as any).admin ?? (companyInput as any).admin ?? settingsInput ?? body;
      const name = cleanText((companyInput as any).name);
      const domain = cleanText((companyInput as any).domain);
      const contactName = cleanText((companyInput as any).contact_name ?? (companyInput as any).contactName ?? (settingsInput as any).contact_name ?? (settingsInput as any).contactName);
      const contactEmail = cleanText((companyInput as any).contact_email ?? (companyInput as any).contactEmail ?? (settingsInput as any).contact_email ?? (settingsInput as any).contactEmail).toLowerCase();
      const contactPhone = cleanText((companyInput as any).contact_phone ?? (companyInput as any).contactPhone ?? (settingsInput as any).contact_phone ?? (settingsInput as any).contactPhone);
      const address = cleanText((companyInput as any).address ?? (settingsInput as any).address);
      const status = cleanText((companyInput as any).status ?? (settingsInput as any).status) || "active";
      const adminFullName = cleanText((adminInput as any).admin_full_name ?? (adminInput as any).full_name ?? (adminInput as any).fullName) || contactName;
      const adminEmail = cleanText((adminInput as any).admin_email ?? (adminInput as any).email).toLowerCase() || contactEmail;

      if (!name) return json(200, { ok: false, error: "Company name is required" });
      if (!contactEmail) return json(200, { ok: false, error: "Contact email is required" });

      const settings = {
        status,
        contact_name: contactName || null,
        contact_email: contactEmail,
        contact_phone: contactPhone || null,
        address: address || null,
      };

      const { data: company, error: companyError } = await serviceClient
        .from("companies")
        .insert({ name, domain: domain || null, settings })
        .select("id, name, domain, settings, created_at, updated_at")
        .single();
      if (companyError) throw companyError;

      let adminResult: Record<string, unknown> | null = null;
      if (adminEmail) {
        const { data: invited, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(adminEmail, {
          data: { full_name: adminFullName || adminEmail, company_id: company.id },
        });

        if (inviteError) {
          adminResult = { created: false, email: adminEmail, warning: inviteError.message };
        } else if (invited?.user?.id) {
          const userId = invited.user.id;
          const { error: profileError } = await serviceClient
            .from("profiles")
            .upsert({ id: userId, company_id: company.id, full_name: adminFullName || adminEmail }, { onConflict: "id" });
          if (profileError) throw profileError;

          const { error: roleError } = await serviceClient
            .from("user_roles")
            .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
          if (roleError) throw roleError;

          adminResult = { created: true, email: adminEmail, user_id: userId };
        }
      }

      return json(200, { ok: true, company, admin: adminResult });
    }

    if (action === "delete") {
      const companyInput = (body as any).company ?? body;
      const companyId = cleanText((companyInput as any).id ?? (body as any).company_id);

      if (!companyId) return json(200, { ok: false, error: "company id is required" });

      const { error } = await serviceClient
        .from("companies")
        .delete()
        .eq("id", companyId);
      if (error) throw error;

      return json(200, { ok: true, deleted: true, company_id: companyId });
    }

    if (action === "update") {
      const companyId = cleanText((body as any).company_id);
      const name = cleanText((body as any).name);
      const domain = cleanText((body as any).domain);
      const status = cleanText((body as any).status) || "active";
      const contactName = cleanText((body as any).contact_name);
      const contactEmail = cleanText((body as any).contact_email).toLowerCase();
      const contactPhone = cleanText((body as any).contact_phone);
      const address = cleanText((body as any).address);

      if (!companyId) return json(200, { ok: false, error: "company_id is required" });
      if (!name) return json(200, { ok: false, error: "Company name is required" });

      const settings = {
        status,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        address: address || null,
      };

      const { data: company, error } = await serviceClient
        .from("companies")
        .update({ name, domain: domain || null, settings })
        .eq("id", companyId)
        .select("id, name, domain, settings, created_at, updated_at")
        .single();
      if (error) throw error;

      return json(200, { ok: true, company });
    }

    return json(200, { ok: false, error: "Unknown action" });
  } catch (err: any) {
    console.error("platform-companies error", err);
    return json(500, { ok: false, error: err?.message || "Internal server error" });
  }
});



