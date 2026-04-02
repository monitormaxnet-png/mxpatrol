import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { selfie_base64, reference_url } = await req.json();

    if (!selfie_base64 || !reference_url) {
      return new Response(
        JSON.stringify({ error: "selfie_base64 and reference_url are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Use AI vision model to compare faces
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a facial verification system for security patrol management. Compare two face images and determine if they show the same person. 
            
You MUST respond with ONLY a JSON object in this exact format:
{"match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}

Rules:
- confidence >= 0.85 means definitive match
- confidence 0.60-0.84 means possible match but uncertain
- confidence < 0.60 means no match
- Consider lighting, angle, accessories (hats, glasses) as factors
- If either image doesn't clearly show a face, set match to false with low confidence
- Be strict: security verification requires high accuracy`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Compare these two face images. The first is the live selfie taken now, the second is the registered reference photo. Are they the same person?",
              },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${selfie_base64}` },
              },
              {
                type: "image_url",
                image_url: { url: reference_url },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI verification failed");
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse the JSON response from AI
    let result;
    try {
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      result = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse AI response:", content);
      result = { match: false, confidence: 0, reason: "Verification system error" };
    }

    return new Response(
      JSON.stringify({
        verified: result.match === true && result.confidence >= 0.75,
        confidence: Math.round((result.confidence || 0) * 100) / 100,
        reason: result.reason || "Unknown",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("face-verify error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
