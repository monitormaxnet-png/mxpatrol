import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const userClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      return new Response(JSON.stringify({ error: "No company associated" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = profile.company_id;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ok */ }
    const reportType = (body.report_type as string) || "daily";

    // Fetch data for the report
    const [guardsRes, patrolsRes, incidentsRes, scansRes, alertsRes] = await Promise.all([
      supabase.from("guards").select("*").eq("company_id", companyId),
      supabase.from("patrols").select("*, guards(full_name)").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50),
      supabase.from("incidents").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(30),
      supabase.from("scan_logs").select("*, guards(full_name), checkpoints(name)").eq("company_id", companyId).order("scanned_at", { ascending: false }).limit(100),
      supabase.from("alerts").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50),
    ]);

    const contextData = {
      guards: guardsRes.data || [],
      patrols: patrolsRes.data || [],
      incidents: incidentsRes.data || [],
      scans: scansRes.data || [],
      alerts: alertsRes.data || [],
    };

    // Call AI for report generation
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a security operations report writer. Generate a comprehensive ${reportType} security patrol report. Use the tool to return structured report data.`,
          },
          {
            role: "user",
            content: `Generate a ${reportType} security report from this data:\n\nGuards (${contextData.guards.length}): ${JSON.stringify(contextData.guards.slice(0, 15))}\n\nPatrols: ${JSON.stringify(contextData.patrols.slice(0, 15))}\n\nIncidents: ${JSON.stringify(contextData.incidents.slice(0, 10))}\n\nScans: ${JSON.stringify(contextData.scans.slice(0, 20))}\n\nAlerts: ${JSON.stringify(contextData.alerts.slice(0, 15))}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_report",
              description: "Generate a structured security report",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Report title" },
                  summary: { type: "string", description: "Executive summary paragraph" },
                  sections: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        heading: { type: "string" },
                        content: { type: "string" },
                      },
                      required: ["heading", "content"],
                      additionalProperties: false,
                    },
                  },
                  recommendations: {
                    type: "array",
                    items: { type: "string" },
                  },
                  stats: {
                    type: "object",
                    properties: {
                      total_patrols: { type: "number" },
                      completion_rate: { type: "number" },
                      total_incidents: { type: "number" },
                      total_scans: { type: "number" },
                      avg_guard_score: { type: "number" },
                    },
                    required: ["total_patrols", "completion_rate", "total_incidents", "total_scans", "avg_guard_score"],
                    additionalProperties: false,
                  },
                },
                required: ["title", "summary", "sections", "recommendations", "stats"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_report" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI report generation failed");
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let reportData: Record<string, unknown> = {};

    if (toolCall?.function?.arguments) {
      reportData = JSON.parse(toolCall.function.arguments);
    }

    // Store report
    const { data: report, error: insertError } = await supabase.from("ai_reports").insert({
      company_id: companyId,
      report_type: reportType,
      summary_text: (reportData.summary as string) || "Report generated",
      data: reportData,
    }).select().single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, report }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-report error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
