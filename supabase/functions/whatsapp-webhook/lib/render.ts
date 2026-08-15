import type { OutMessage } from "./types.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

/** Plain-text fallback rendering: numbered options that users can reply to. */
export function renderText(message: OutMessage): string {
  const parts: string[] = [];
  if (message.title) parts.push(`*${message.title}*`);
  if (message.lines.length) parts.push(message.lines.join("\n"));
  if (message.options?.length) {
    parts.push(
      message.options
        .map((option, index) => `${index + 1}. ${option.label}`)
        .join("\n"),
    );
  }
  parts.push(message.footer ?? "Reply with a number, or type *menu*.");
  return parts.filter(Boolean).join("\n\n").slice(0, 1500);
}

export function twiml(body: string): string {
  const escaped = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Message>${escaped}</Message>\n</Response>`;
}

/**
 * Sends a message out-of-band through Twilio.
 * Uses an approved Content template (quick-reply buttons / list picker) when one is
 * configured, and falls back to plain numbered text otherwise.
 */
export async function sendWhatsApp(to: string, message: OutMessage): Promise<boolean> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twilioKey = Deno.env.get("TWILIO_API_KEY");
  const from = Deno.env.get("TWILIO_WHATSAPP_NUMBER");
  if (!lovableKey || !twilioKey || !from) {
    console.warn("[WA] outbound skipped — Twilio not fully configured");
    return false;
  }

  const buttonSid = Deno.env.get("TWILIO_WA_BUTTONS_CONTENT_SID");
  const listSid = Deno.env.get("TWILIO_WA_LIST_CONTENT_SID");
  const optionCount = message.options?.length ?? 0;
  const contentSid = optionCount > 0 && optionCount <= 3 ? buttonSid : optionCount > 3 ? listSid : null;

  const body: Record<string, string> = {
    To: `whatsapp:${to.replace(/^whatsapp:/i, "")}`,
    From: `whatsapp:${from}`,
  };

  if (contentSid) {
    const variables: Record<string, string> = { "1": renderText({ ...message, options: [] }) };
    (message.options ?? []).forEach((option, index) => {
      variables[String(index + 2)] = option.label.slice(0, 24);
    });
    body.ContentSid = contentSid;
    body.ContentVariables = JSON.stringify(variables);
  } else {
    body.Body = renderText(message);
  }

  const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[WA] send failed [${response.status}]: ${text}`);
    if (contentSid) {
      // Template rejected/not approved — retry as plain text so the user still gets a reply.
      return await sendWhatsApp(to, { ...message, options: message.options, footer: message.footer });
    }
    return false;
  }
  return true;
}

/** Sends a WhatsApp location pin. */
export async function sendLocation(to: string, lat: number, lng: number, label: string): Promise<boolean> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twilioKey = Deno.env.get("TWILIO_API_KEY");
  const from = Deno.env.get("TWILIO_WHATSAPP_NUMBER");
  if (!lovableKey || !twilioKey || !from) return false;

  const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: `whatsapp:${to.replace(/^whatsapp:/i, "")}`,
      From: `whatsapp:${from}`,
      PersistentAction: `geo:${lat},${lng}|${label}`,
      Body: `📍 ${label}\nhttps://maps.google.com/?q=${lat},${lng}`,
    }),
  });
  if (!response.ok) console.error("[WA] location send failed:", await response.text());
  return response.ok;
}
