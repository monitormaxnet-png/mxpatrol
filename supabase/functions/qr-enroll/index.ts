import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: roleData } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      return new Response(JSON.stringify({ error: "No company found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const appType = body.app_type || "guard_device";
    const expiryMinutes = Math.min(Math.max(body.expiry_minutes || 15, 5), 1440);
    const count = Math.min(Math.max(body.count || 1, 1), 100);

    if (!["admin_app", "guard_device"].includes(appType)) {
      return new Response(JSON.stringify({ error: "Invalid app_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokens: { token: string; nonce: string; expires_at: string }[] = [];

    for (let i = 0; i < count; i++) {
      const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const expiresAt = new Date(
        Date.now() + expiryMinutes * 60 * 1000
      ).toISOString();

      // Build a simple signed token (base64 JSON with HMAC)
      const payload = {
        tid: profile.company_id,
        app: appType,
        nonce,
        exp: Math.floor(Date.now() / 1000) + expiryMinutes * 60,
      };

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const payloadB64 = btoa(JSON.stringify(payload));
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(payloadB64)
      );
      const sigB64 = btoa(
        String.fromCharCode(...new Uint8Array(signature))
      );

      const token = `${payloadB64}.${sigB64}`;

      const { error: insertError } = await serviceClient
        .from("enrollment_tokens")
        .insert({
          company_id: profile.company_id,
          app_type: appType,
          token,
          nonce,
          expires_at: expiresAt,
          created_by: user.id,
        });

      if (insertError) throw insertError;

      tokens.push({ token, nonce, expires_at: expiresAt });
    }

    return new Response(
      JSON.stringify({
        tokens,
        count: tokens.length,
        app_type: appType,
        expiry_minutes: expiryMinutes,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
