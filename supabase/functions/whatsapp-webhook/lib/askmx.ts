export type Intent =
  | { action: "menu" }
  | { action: "live" }
  | { action: "attention"; filter?: "all" | "sos" | "missed" | "offline" }
  | { action: "patrols" }
  | { action: "devices"; filter?: "offline" | "online" | "all" }
  | { action: "device_detail"; device: string }
  | { action: "incidents" }
  | { action: "reports"; period?: "today" | "yesterday" | "week"; problems_only?: boolean }
  | { action: "setup" }
  | { action: "register_device" }
  | { action: "add_checkpoint" }
  | { action: "create_patrol" }
  | { action: "report_incident" }
  | { action: "change_site" }
  | { action: "unknown"; reply?: string };

const SCHEMA = `Return ONLY JSON matching one of these shapes:
{"action":"menu"}
{"action":"live"}
{"action":"patrols"}
{"action":"attention","filter":"all|sos|missed|offline"}
{"action":"devices","filter":"all|online|offline"}
{"action":"device_detail","device":"RG360-08"}
{"action":"incidents"}
{"action":"reports","period":"today|yesterday|week","problems_only":true|false}
{"action":"setup"}
{"action":"register_device"}
{"action":"add_checkpoint"}
{"action":"create_patrol"}
{"action":"report_incident"}
{"action":"change_site"}
{"action":"unknown","reply":"one short helpful sentence"}`;

/** Fast keyword routing so common phrasing never needs the model. */
export function keywordIntent(text: string): Intent | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (/^(hi|hello|hey|menu|start|help|0)$/.test(value)) return { action: "menu" };
  if (/^(live|live now)$/.test(value)) return { action: "live" };
  if (/^(attention|problems?|alerts?)$/.test(value)) return { action: "attention", filter: "all" };
  if (/^(devices?)$/.test(value)) return { action: "devices", filter: "all" };
  if (/^(incidents?)$/.test(value)) return { action: "incidents" };
  if (/^(reports?|summary)$/.test(value)) return { action: "reports" };
  if (/^(setup|settings)$/.test(value)) return { action: "setup" };
  if (/^(change site|switch site|site)$/.test(value)) return { action: "change_site" };
  if (/^(sos|panic)/.test(value)) return { action: "attention", filter: "sos" };
  if (/(which|what).*(devices?).*(offline|down)/.test(value)) return { action: "devices", filter: "offline" };
  const where = value.match(/where\s+is\s+([a-z0-9\-_.]+)/i);
  if (where) return { action: "device_detail", device: where[1] };
  return null;
}

/** Falls back to the AI gateway to classify free-form questions. */
export async function classifyIntent(text: string): Promise<Intent> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { action: "unknown" };

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              `You route WhatsApp messages for MX Patrol, a security patrol platform. ${SCHEMA}\nNo markdown, no explanation.`,
          },
          { role: "user", content: text.slice(0, 500) },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[WA] intent classify failed:", response.status, await response.text());
      return { action: "unknown" };
    }

    const payload = await response.json();
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { action: "unknown" };
    const parsed = JSON.parse(match[0]);
    if (typeof parsed?.action === "string") return parsed as Intent;
    return { action: "unknown" };
  } catch (error) {
    console.error("[WA] intent classify error:", error);
    return { action: "unknown" };
  }
}
