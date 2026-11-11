// Pure helpers are shared by the webhook, sender, and regression tests.
export type MetaOption = { id: string; label: string };
export type MetaMenu = { title?: string; lines: string[]; options?: MetaOption[]; footer?: string };
export type MetaConfig = { token: string; phoneNumberId: string; version?: string };
export type MetaInbound = { id: string; from: string; body: string; selectionId?: string; phoneNumberId: string };

export class MetaError extends Error {
  constructor(public status: number, public details: string) { super(`Meta request failed [${status}]: ${details}`); }
}

export async function verifyMetaSignature(raw: string, signature: string | null, appSecret: string): Promise<boolean> {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature) || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.slice(7).match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(raw));
}

export function verifyMetaChallenge(url: URL, token: string | undefined): string | null {
  const challenge = url.searchParams.get("hub.challenge");
  return token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token && challenge && /^\d{1,100}$/.test(challenge) ? challenge : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseMetaPayload(payload: unknown, phoneNumberId: string): { messages: MetaInbound[]; statuses: Record<string, unknown>[] } {
  const root = object(payload);
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) throw new Error("Invalid WhatsApp webhook envelope");
  const messages: MetaInbound[] = [];
  const statuses: Record<string, unknown>[] = [];
  for (const entry of root.entry) {
    const changes = object(entry).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = object(object(change).value);
      if (object(value.metadata).phone_number_id !== phoneNumberId) continue;
      if (Array.isArray(value.statuses)) statuses.push(...value.statuses.map(object));
      if (!Array.isArray(value.messages)) continue;
      for (const candidate of value.messages) {
        const message = object(candidate);
        if (typeof message.id !== "string" || message.id.length > 200 || typeof message.from !== "string" || !/^[1-9]\d{6,14}$/.test(message.from)) throw new Error("Invalid WhatsApp message identifier or sender");
        const interactive = object(message.interactive);
        const reply = object(interactive.button_reply ?? interactive.list_reply);
        const button = object(message.button);
        const selectionId = typeof reply.id === "string" ? reply.id : typeof button.payload === "string" ? button.payload : undefined;
        const text = object(message.text).body;
        const body = typeof text === "string" ? text : selectionId ?? "";
        if (body.length > 4096 || (selectionId?.length ?? 0) > 200) throw new Error("WhatsApp message is too long");
        messages.push({ id: message.id, from: message.from, body, selectionId, phoneNumberId });
      }
    }
  }
  return { messages, statuses };
}

export function metaMenuPayload(to: string, menu: MetaMenu, plain = false): Record<string, unknown> {
  const recipient = to.replace(/^whatsapp:/i, "").replace(/^\+/, "");
  if (!/^[1-9]\d{6,14}$/.test(recipient)) throw new Error("Invalid WhatsApp recipient");
  const options = menu.options ?? [];
  const text = [menu.title ? `*${menu.title}*` : "", ...menu.lines].filter(Boolean).join("\n\n");
  const base = { messaging_product: "whatsapp", to: recipient };
  if (plain || !options.length || options.length > 10) {
    const numbered = options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");
    return { ...base, type: "text", text: { body: [text, numbered, menu.footer].filter(Boolean).join("\n\n").slice(0, 4096) } };
  }
  const interactive: Record<string, unknown> = { type: options.length <= 3 ? "button" : "list", body: { text: text.slice(0, 1024) || "MX Patrol" } };
  if (menu.footer) interactive.footer = { text: menu.footer.slice(0, 60) };
  interactive.action = options.length <= 3
    ? { buttons: options.map((option) => ({ type: "reply", reply: { id: option.id, title: option.label.slice(0, 20) } })) }
    : { button: "Choose", sections: [{ title: "MX Patrol", rows: options.map((option) => ({ id: option.id, title: option.label.slice(0, 24) })) }] };
  return { ...base, type: "interactive", interactive };
}

export async function metaRequest(config: MetaConfig, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Record<string, any>> {
  if (!config.token || !/^\d+$/.test(config.phoneNumberId)) throw new Error("Meta WhatsApp is not configured");
  const version = config.version ?? "v25.0";
  if (!/^v\d+\.\d+$/.test(version) || !/^[A-Za-z0-9_/-]+$/.test(path)) throw new Error("Invalid Meta endpoint");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  const response = await fetcher(`https://graph.facebook.com/${version}/${path}`, { ...init, headers });
  const raw = await response.text();
  if (!response.ok) throw new MetaError(response.status, raw);
  const result = JSON.parse(raw);
  if (result.error) throw new MetaError(502, raw);
  return result;
}

export async function sendMeta(config: MetaConfig, payload: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<string> {
  const result = await metaRequest(config, `${config.phoneNumberId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, fetcher);
  const id = result.messages?.[0]?.id;
  if (typeof id !== "string") throw new Error("Meta did not return a message ID");
  return id;
}

export async function sendMetaPdf(config: MetaConfig, to: string, pdf: Blob, filename: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (pdf.type !== "application/pdf") throw new Error("Expected a PDF report");
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", "application/pdf");
  form.set("file", pdf, filename);
  const uploaded = await metaRequest(config, `${config.phoneNumberId}/media`, { method: "POST", body: form }, fetcher);
  if (typeof uploaded.id !== "string" || !/^\d+$/.test(uploaded.id)) throw new Error("Meta did not return a media ID");
  try {
    const base = metaMenuPayload(to, { lines: ["Report"] });
    return await sendMeta(config, { messaging_product: "whatsapp", to: base.to, type: "document", document: { id: uploaded.id, filename } }, fetcher);
  } finally {
    try { await metaRequest(config, uploaded.id, { method: "DELETE" }, fetcher); }
    catch { console.warn("[WA] Meta media cleanup failed; check provider retention"); }
  }
}