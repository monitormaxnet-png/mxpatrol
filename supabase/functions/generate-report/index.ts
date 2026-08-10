import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const dbDetails = (error: any) => ({
  code: error?.code ?? null,
  message: error?.message ?? null,
  details: error?.details ?? null,
  hint: error?.hint ?? null,
});

const dbError = (message: string, error: any) => json({ error: message, details: dbDetails(error) }, 500);

const dateRangeStart = (range: unknown) => {
  const date = new Date();
  if (range === "today") date.setHours(0, 0, 0, 0);
  else if (range === "30d") date.setDate(date.getDate() - 30);
  else date.setDate(date.getDate() - 7);
  return date.toISOString();
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let reportJobId: string | null = null;

  const markJobFailed = async (message: string) => {
    if (!reportJobId) return;
    await supabase
      .from("report_jobs")
      .update({ status: "failed", failed_at: new Date().toISOString(), error_message: message })
      .eq("id", reportJobId);
  };

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();
    if (profileError) return dbError("Profile lookup failed", profileError);
    if (!profile?.company_id) return json({ error: "No company associated" }, 400);

    const companyId = profile.company_id;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body is allowed */ }

    const reportType = (body.report_type as string) || "daily";
    const siteId = typeof body.site_id === "string" && body.site_id ? body.site_id : null;
    const dateRange = typeof body.date_range === "string" ? body.date_range : "7d";
    const since = dateRangeStart(dateRange);

    const { data: job, error: jobError } = await supabase
      .from("report_jobs")
      .insert({
        company_id: companyId,
        site_id: siteId,
        report_type: reportType,
        status: "pending",
        date_range: dateRange,
        created_by: user.id,
        filters: { site_id: siteId, since, date_range: dateRange },
      })
      .select("id")
      .single();
    if (jobError) return dbError("Failed to create report job", jobError);
    reportJobId = job.id;

    await supabase
      .from("report_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", reportJobId);

    const guardsQuery = supabase.from("guards").select("*").eq("company_id", companyId);
    const patrolsQuery = supabase
      .from("patrols")
      .select("*, guards(full_name)")
      .eq("company_id", companyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    const incidentsQuery = supabase
      .from("incidents")
      .select("*")
      .eq("company_id", companyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(30);
    let scansQuery = supabase
      .from("scan_logs")
      .select("*, guards(full_name), checkpoints(name, site_id, sites(name)), sites(name)")
      .eq("company_id", companyId)
      .not("checkpoint_id", "is", null)
      .neq("tag_status", "unregistered")
      .neq("tag_status", "rejected")
      .gte("scanned_at", since)
      .order("scanned_at", { ascending: false })
      .limit(100);
    const alertsQuery = supabase
      .from("alerts")
      .select("*")
      .eq("company_id", companyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    let sessionReportsQuery = supabase
      .from("patrol_session_reports")
      .select("*")
      .eq("company_id", companyId)
      .gte("scheduled_start", since)
      .order("scheduled_start", { ascending: false })
      .limit(100);

    if (siteId) scansQuery = scansQuery.eq("site_id", siteId);
    if (siteId) sessionReportsQuery = sessionReportsQuery.eq("site_id", siteId);

    const [guardsRes, patrolsRes, incidentsRes, scansRes, alertsRes, sessionReportsRes] = await Promise.all([
      guardsQuery,
      patrolsQuery,
      incidentsQuery,
      scansQuery,
      alertsQuery,
      sessionReportsQuery,
    ]);

    if (guardsRes.error) { await markJobFailed(guardsRes.error.message); return dbError("Failed to load guards", guardsRes.error); }
    if (patrolsRes.error) { await markJobFailed(patrolsRes.error.message); return dbError("Failed to load patrols", patrolsRes.error); }
    if (incidentsRes.error) { await markJobFailed(incidentsRes.error.message); return dbError("Failed to load incidents", incidentsRes.error); }
    if (scansRes.error) { await markJobFailed(scansRes.error.message); return dbError("Failed to load registered scans", scansRes.error); }
    if (alertsRes.error) { await markJobFailed(alertsRes.error.message); return dbError("Failed to load alerts", alertsRes.error); }

    const contextData = {
      guards: guardsRes.data || [],
      patrols: patrolsRes.data || [],
      patrolSessions: sessionReportsRes.data || [],
      incidents: incidentsRes.data || [],
      scans: scansRes.data || [],
      alerts: alertsRes.data || [],
    };

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
            content: `You are a security operations report writer. Generate a comprehensive ${reportType} security patrol report. Treat canonical patrol session reports as the source of truth for completion, missed checkpoints, incidents, SOS counts, and route execution. Use raw scans only as supporting audit evidence. Use the tool to return structured report data.`,
          },
          {
            role: "user",
            content: `Generate a ${reportType} security report from this filtered operational data. Filters: company_id=${companyId}, site_id=${siteId ?? "all"}, since=${since}.\n\nCanonical patrol session reports (${contextData.patrolSessions.length}): ${JSON.stringify(contextData.patrolSessions.slice(0, 30))}\n\nGuards (${contextData.guards.length}): ${JSON.stringify(contextData.guards.slice(0, 15))}\n\nLegacy patrol rows: ${JSON.stringify(contextData.patrols.slice(0, 15))}\n\nIncidents: ${JSON.stringify(contextData.incidents.slice(0, 10))}\n\nRegistered scan audit events (${contextData.scans.length}): ${JSON.stringify(contextData.scans.slice(0, 20))}\n\nAlerts: ${JSON.stringify(contextData.alerts.slice(0, 15))}`,
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
                  recommendations: { type: "array", items: { type: "string" } },
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
      const message = aiResponse.status === 429
        ? "Rate limit exceeded, try again later."
        : aiResponse.status === 402
          ? "AI credits exhausted."
          : "AI report generation failed";
      await markJobFailed(message);
      return json({ error: message }, aiResponse.status === 429 || aiResponse.status === 402 ? aiResponse.status : 500);
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let reportData: Record<string, unknown> = {};

    if (toolCall?.function?.arguments) reportData = JSON.parse(toolCall.function.arguments);

    const { data: report, error: insertError } = await supabase.from("ai_reports").insert({
      company_id: companyId,
      report_type: reportType,
      summary_text: (reportData.summary as string) || "Report generated",
      data: { ...reportData, filters: { site_id: siteId, since, date_range: dateRange } },
    }).select().single();

    if (insertError) {
      await markJobFailed(insertError.message);
      return dbError("Failed to save generated report", insertError);
    }

    const { error: completeError } = await supabase
      .from("report_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString(), report_id: report.id, error_message: null })
      .eq("id", reportJobId);
    if (completeError) return dbError("Report generated but job completion failed", completeError);

    return json({ success: true, report, job_id: reportJobId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await markJobFailed(message);
    console.error("generate-report error:", e);
    return json({ error: message }, 500);
  }
});
