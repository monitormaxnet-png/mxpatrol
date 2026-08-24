declare const Deno: { env: { get(key: string): string | undefined } };
export type Intent =
  | { action: "menu" }
  | { action: "live" }
  | { action: "attention"; filter?: "all" | "sos" | "missed" | "offline" }
  | { action: "patrols" }
  | { action: "patrol_status" }
  | { action: "devices"; filter?: "offline" | "online" | "all" }
  | { action: "device_detail"; device: string }
  | { action: "incidents" }
  | { action: "reports"; period?: "today" | "yesterday" | "week"; problems_only?: boolean }
  | { action: "completed_patrols" }
  | { action: "incomplete_patrols" }
  | { action: "late_patrols" }
  | { action: "missed_patrols" }
  | { action: "missed_checkpoints" }
  | { action: "checkpoints" }
  | { action: "management" }
  | { action: "user" }
  | { action: "setup" }
  | { action: "register_device" }
  | { action: "add_checkpoint" }
  | { action: "create_patrol" }
  | { action: "report_incident" }
  | { action: "change_site" }
  | { action: "secure_devices" }
  | { action: "secure_device_status" }
  | { action: "secure_device_problems" }
  | { action: "secure_device_detail"; device?: string }
  | { action: "secure_device_action"; secureAction: "request_device_lock" | "request_device_disable" | "request_device_enable" | "request_maintenance_mode" | "request_exit_maintenance" | "request_app_update" | "request_integrity_check" | "revoke_device"; device?: string }
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
{"action":"completed_patrols"}
{"action":"incomplete_patrols"}
{"action":"late_patrols"}
{"action":"missed_patrols"}
{"action":"missed_checkpoints"}
{"action":"checkpoints"}
{"action":"management"}
{"action":"user"}
{"action":"setup"}
{"action":"register_device"}
{"action":"add_checkpoint"}
{"action":"create_patrol"}
{"action":"report_incident"}
{"action":"change_site"}
{"action":"secure_devices"}
{"action":"secure_device_status"}
{"action":"secure_device_problems"}
{"action":"secure_device_detail","device":"MX-021"}
{"action":"secure_device_action","secureAction":"request_device_lock|request_device_disable|request_maintenance_mode|request_app_update|request_integrity_check|revoke_device","device":"MX-021"}
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
  if (/^(patrol status|patrols? status)$/.test(value)) return { action: "patrol_status" };
  const reportPeriod = value.match(/(today|yesterday|this week|week)[a-z'\s]*report|report[a-z'\s]*(today|yesterday|this week|week)/);
  if (reportPeriod) {
    const token = (reportPeriod[1] ?? reportPeriod[2] ?? "today").toLowerCase();
    const period = token.includes("yesterday") ? "yesterday" : token.includes("week") ? "week" : "today";
    return { action: "reports", period };
  }
  if (/^(reports?|summary)$/.test(value)) return { action: "reports" };
  if (/(show|view|give me|list).*(reports?|summary)/.test(value)) return { action: "reports" };
  if (/generate.*(patrol )?report/.test(value)) return { action: "reports" };
  if (/^(setup|settings)$/.test(value)) return { action: "setup" };
  if (/^(change site|switch site|site)$/.test(value)) return { action: "change_site" };
  if (/^(management|manager|admin)$/i.test(value)) return { action: "management" };
  if (/^(secure devices?|device security|secure patrol devices?)$/i.test(value)) return { action: "secure_devices" };
  if (/^(secure device status|device security status)$/i.test(value)) return { action: "secure_device_status" };
  if (/(security problems|secure.*problems|devices?.*(outdated|developer mode|kiosk|insecure|security issue)|which devices need app update)/i.test(value)) return { action: "secure_device_problems" };
  const secureInfo = value.match(/(?:secure info|device info|security info)\s+([a-z0-9\-_.]+)/i);
  if (secureInfo) return { action: "secure_device_detail", device: secureInfo[1] };
  const secureAction = value.match(/^(lock|disable|enable|revoke|update|maintenance|maintain|security check|integrity check)\s+(?:device\s+)?([a-z0-9\-_.]+)?/i);
  if (secureAction) {
    const verb = secureAction[1].toLowerCase();
    const action = verb === "lock" ? "request_device_lock"
      : verb === "disable" ? "request_device_disable"
      : verb === "enable" ? "request_device_enable"
      : verb === "revoke" ? "revoke_device"
      : verb === "update" ? "request_app_update"
      : verb === "security check" || verb === "integrity check" ? "request_integrity_check"
      : "request_maintenance_mode";
    return { action: "secure_device_action", secureAction: action as any, device: secureAction[2] };
  }
  if (/^(user|user assistant)$/i.test(value)) return { action: "user" };
  if (/incomplete patrols?/.test(value)) return { action: "incomplete_patrols" };
  if (/completed patrols?|complete patrols?/.test(value)) return { action: "completed_patrols" };
  if (/(late|delayed).*patrols?/.test(value)) return { action: "late_patrols" };
  if (/missed patrols?/.test(value)) return { action: "missed_patrols" };
  if (/missed checkpoints?|checkpoints?.*missed/.test(value)) return { action: "missed_checkpoints" };
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
