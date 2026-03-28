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

    // Get auth user from request
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

    // Get user's company_id
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

    // Fetch recent data for analysis
    const [guardsRes, patrolsRes, alertsRes, scansRes, incidentsRes] = await Promise.all([
      supabase.from("guards").select("*").eq("company_id", companyId),
      supabase.from("patrols").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50),
      supabase.from("alerts").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50),
      supabase.from("scan_logs").select("*, checkpoints(name)").eq("company_id", companyId).order("scanned_at", { ascending: false }).limit(100),
      supabase.from("incidents").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(30),
    ]);

    const contextData = {
      guards: guardsRes.data || [],
      patrols: patrolsRes.data || [],
      alerts: alertsRes.data || [],
      scans: scansRes.data || [],
      incidents: incidentsRes.data || [],
    };

    // Call Lovable AI for analysis
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
            content: `You are a security patrol intelligence analyst. Analyze the provided patrol data and generate actionable insights. Return a JSON array of insights, each with: type (string, e.g. "Zone Risk", "Guard Performance", "Coverage Gap"), summary (brief description), trend ("up", "down", "stable"), score (0-100 risk score), severity ("low", "medium", "high", "critical"). Return 3-5 insights. Only output valid JSON array, no markdown.`,
          },
          {
            role: "user",
            content: `Analyze this patrol data:\n\nGuards (${contextData.guards.length}): ${JSON.stringify(contextData.guards.slice(0, 20))}\n\nRecent Patrols: ${JSON.stringify(contextData.patrols.slice(0, 20))}\n\nRecent Alerts: ${JSON.stringify(contextData.alerts.slice(0, 20))}\n\nRecent Scans: ${JSON.stringify(contextData.scans.slice(0, 30))}\n\nRecent Incidents: ${JSON.stringify(contextData.incidents.slice(0, 10))}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_insights",
              description: "Generate patrol intelligence insights",
              parameters: {
                type: "object",
                properties: {
                  insights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        summary: { type: "string" },
                        trend: { type: "string", enum: ["up", "down", "stable"] },
                        score: { type: "number" },
                        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                      },
                      required: ["type", "summary", "trend", "score", "severity"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["insights"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_insights" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let insights: Array<{ type: string; summary: string; trend: string; score: number; severity: string }> = [];

    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      insights = parsed.insights || [];
    }

    // Store insights in database
    if (insights.length > 0) {
      const rows = insights.map((insight) => ({
        company_id: companyId,
        type: insight.type,
        summary: insight.summary,
        severity: insight.severity as "low" | "medium" | "high" | "critical",
        data: { trend: insight.trend, score: insight.score },
      }));

      await supabase.from("ai_insights").insert(rows);
    }

    return new Response(JSON.stringify({ success: true, insights }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("patrol-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
