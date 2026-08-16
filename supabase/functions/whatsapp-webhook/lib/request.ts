export type InboundWhatsAppMessage = {
  from: string;
  to: string;
  body: string;
  messageSid: string | null;
  accountSid: string | null;
  profileName: string | null;
  waId: string | null;
  mediaUrls: string[];
  contentType: string;
  isTwilioForm: boolean;
};

export async function parseInboundWhatsAppRequest(req: Request): Promise<InboundWhatsAppMessage> {
  const contentType = req.headers.get("content-type") ?? "";
  const mediaUrls: string[] = [];

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    let body = String(form.get("Body") ?? "");
    const count = Number(form.get("NumMedia") ?? 0);
    for (let index = 0; index < count; index += 1) {
      const url = form.get("MediaUrl" + index);
      if (url) mediaUrls.push(String(url));
    }
    const buttonPayload = form.get("ButtonPayload") ?? form.get("ListId") ?? form.get("ButtonText");
    if (buttonPayload && !body) body = String(buttonPayload);

    return {
      from: String(form.get("From") ?? ""),
      to: String(form.get("To") ?? ""),
      body,
      messageSid: cleanSid(form.get("MessageSid") ?? form.get("SmsMessageSid")),
      accountSid: cleanSid(form.get("AccountSid")),
      profileName: nullableString(form.get("ProfileName")),
      waId: nullableString(form.get("WaId")),
      mediaUrls,
      contentType,
      isTwilioForm: true,
    };
  }

  const json = await req.json();
  if (Array.isArray(json.media)) mediaUrls.push(...json.media.map(String));

  return {
    from: json.From ?? json.from ?? "",
    to: json.To ?? json.to ?? "",
    body: json.Body ?? json.body ?? "",
    messageSid: cleanSid(json.MessageSid ?? json.SmsMessageSid ?? json.messageSid ?? json.sid),
    accountSid: cleanSid(json.AccountSid ?? json.accountSid),
    profileName: nullableString(json.ProfileName ?? json.profileName),
    waId: nullableString(json.WaId ?? json.waId),
    mediaUrls,
    contentType,
    isTwilioForm: false,
  };
}

export function emptyTwiml(): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>';
}

function nullableString(value: FormDataEntryValue | string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function cleanSid(value: FormDataEntryValue | string | null | undefined): string | null {
  const text = nullableString(value);
  return text && /^[A-Za-z0-9_-]{10,80}$/.test(text) ? text : null;
}
