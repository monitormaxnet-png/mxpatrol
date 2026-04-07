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

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify admin
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
    const { device_id, action, replace_with_device_id, command_type, command_payload } = body;

    if (!device_id) {
      return new Response(JSON.stringify({ error: "device_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify device belongs to same company
    const { data: device, error: devErr } = await serviceClient
      .from("devices")
      .select("*")
      .eq("id", device_id)
      .eq("company_id", profile.company_id)
      .single();

    if (devErr || !device) {
      return new Response(JSON.stringify({ error: "Device not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: any = { success: true };

    switch (action) {
      case "activate": {
        await serviceClient
          .from("devices")
          .update({ status: "online" })
          .eq("id", device_id);
        await serviceClient.from("device_activity_logs").insert({
          device_id,
          company_id: profile.company_id,
          action: "activated",
          performed_by: user.id,
        });
        result.status = "online";
        break;
      }
      case "suspend": {
        await serviceClient
          .from("devices")
          .update({ status: "offline" })
          .eq("id", device_id);
        await serviceClient.from("device_activity_logs").insert({
          device_id,
          company_id: profile.company_id,
          action: "suspended",
          performed_by: user.id,
        });
        result.status = "offline";
        break;
      }
      case "revoke": {
        await serviceClient
          .from("devices")
          .update({ status: "offline", pairing_status: "revoked" })
          .eq("id", device_id);
        await serviceClient.from("device_activity_logs").insert({
          device_id,
          company_id: profile.company_id,
          action: "revoked",
          performed_by: user.id,
        });
        result.status = "revoked";
        break;
      }
      case "replace": {
        if (!replace_with_device_id) {
          return new Response(
            JSON.stringify({ error: "replace_with_device_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Revoke old device
        await serviceClient
          .from("devices")
          .update({ status: "offline", pairing_status: "revoked" })
          .eq("id", device_id);
        // Transfer guard assignment
        if (device.guard_id) {
          await serviceClient
            .from("devices")
            .update({ guard_id: device.guard_id })
            .eq("id", replace_with_device_id);
        }
        await serviceClient.from("device_activity_logs").insert({
          device_id,
          company_id: profile.company_id,
          action: "replaced",
          performed_by: user.id,
          metadata: { replaced_by: replace_with_device_id },
        });
        result.replaced_by = replace_with_device_id;
        break;
      }
      case "command": {
        if (!command_type) {
          return new Response(
            JSON.stringify({ error: "command_type is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data: cmd, error: cmdErr } = await serviceClient
          .from("device_commands")
          .insert({
            device_id,
            company_id: profile.company_id,
            command_type,
            payload: command_payload || {},
            issued_by: user.id,
          })
          .select("id")
          .single();
        if (cmdErr) throw cmdErr;
        await serviceClient.from("device_activity_logs").insert({
          device_id,
          company_id: profile.company_id,
          action: "command_sent",
          performed_by: user.id,
          metadata: { command_id: cmd.id, command_type },
        });
        result.command_id = cmd.id;
        break;
      }
      default:
        return new Response(
          JSON.stringify({ error: "Invalid action. Use: activate, suspend, revoke, replace, command" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
