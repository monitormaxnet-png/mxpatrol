import { describe, expect, it } from "vitest";
import { emptyTwiml, parseInboundWhatsAppRequest } from "../../supabase/functions/whatsapp-webhook/lib/request";

describe("WhatsApp webhook request parsing", () => {
  it("normalizes Twilio form-urlencoded payloads", async () => {
    const form = new URLSearchParams({
      From: "whatsapp:+27821234567",
      To: "whatsapp:+14155238886",
      Body: "menu",
      MessageSid: "SM1234567890abcdef",
      AccountSid: "AC1234567890abcdef",
      ProfileName: "Ops Lead",
      WaId: "27821234567",
      NumMedia: "1",
      MediaUrl0: "https://example.test/photo.jpg",
    });

    const parsed = await parseInboundWhatsAppRequest(
      new Request("https://example.test/functions/v1/whatsapp-webhook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
    );

    expect(parsed).toMatchObject({
      from: "whatsapp:+27821234567",
      to: "whatsapp:+14155238886",
      body: "menu",
      messageSid: "SM1234567890abcdef",
      accountSid: "AC1234567890abcdef",
      profileName: "Ops Lead",
      waId: "27821234567",
      isTwilioForm: true,
    });
    expect(parsed.mediaUrls).toEqual(["https://example.test/photo.jpg"]);
  });

  it("uses button/list payloads when Body is empty", async () => {
    const form = new URLSearchParams({
      From: "whatsapp:+27821234567",
      ButtonPayload: "devices",
      NumMedia: "0",
    });

    const parsed = await parseInboundWhatsAppRequest(
      new Request("https://example.test/functions/v1/whatsapp-webhook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
    );

    expect(parsed.body).toBe("devices");
  });

  it("parses JSON test harness payloads and rejects malformed SIDs", async () => {
    const parsed = await parseInboundWhatsAppRequest(
      new Request("https://example.test/functions/v1/whatsapp-webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "+27821234567", body: "reports", sid: "bad sid with spaces", media: ["a", "b"] }),
      }),
    );

    expect(parsed.from).toBe("+27821234567");
    expect(parsed.body).toBe("reports");
    expect(parsed.messageSid).toBeNull();
    expect(parsed.mediaUrls).toEqual(["a", "b"]);
    expect(parsed.isTwilioForm).toBe(false);
  });

  it("can produce an empty TwiML response for duplicate Twilio retries", () => {
    expect(emptyTwiml()).toContain("<Response></Response>");
  });
});
