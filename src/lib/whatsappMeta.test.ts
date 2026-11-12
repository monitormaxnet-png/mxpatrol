// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { verifyMetaSignature, verifyMetaChallenge, parseMetaPayload, metaMenuPayload, sendMetaPdf, MetaError } from "../../supabase/functions/_shared/whatsapp/meta";
import { reportWindow, generateWhatsAppPdf } from "../../supabase/functions/whatsapp-webhook/lib/pdf-reports";
import { buildMxPdfReportBlob as serverPdf } from "../../supabase/functions/_shared/whatsapp/pdf";
import { buildMxPdfReportBlob as browserPdf } from "./mxPdfReports";
import { resolveMenuChoice } from "../../supabase/functions/whatsapp-webhook/lib/views";
import type { Identity, SessionRow } from "../../supabase/functions/whatsapp-webhook/lib/types";

const config = { token: "test-only-token", phoneNumberId: "123456" };
const identity: Identity = { id: "auth", phone: "+27820000000", company_id: "company-a", user_id: "user", guard_id: null, display_name: "TEST User", role: "guard", allowed_site_ids: ["site-a"], canManage: false, canManageKiosk: false, canManageSecureDevices: false, platformRole: null, canSetup: false, canAcknowledge: false };
const envelope = (messages: unknown[], phone = config.phoneNumberId) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: phone }, messages } }] }] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Meta webhook security", () => {
  it("accepts only the configured verification token and subscribe mode", () => {
    expect(verifyMetaChallenge(new URL("https://test.invalid?hub.mode=subscribe&hub.verify_token=test-only&hub.challenge=123"), "test-only")).toBe("123");
    expect(verifyMetaChallenge(new URL("https://test.invalid?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"), "test-only")).toBeNull();
  });
  it("verifies the signature against the unmodified body and rejects tampering", async () => {
    const raw = JSON.stringify(envelope([]));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-only-app-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = "sha256=" + Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(await verifyMetaSignature(raw, signature, "test-only-app-secret")).toBe(true);
    expect(await verifyMetaSignature(raw + " ", signature, "test-only-app-secret")).toBe(false);
    expect(await verifyMetaSignature(raw, null, "test-only-app-secret")).toBe(false);
  });
  it("ignores messages for another business number", () => {
    expect(parseMetaPayload(envelope([{ id: "wamid.test", from: "27820000000", text: { body: "Reports" } }], "999"), "123456").messages).toHaveLength(0);
  });
  it("reads list and button IDs without treating labels as commands", () => {
    const payload = envelope([{ id: "wamid.list", from: "27820000000", interactive: { list_reply: { id: "reports_incidents", title: "label" } } }, { id: "wamid.button", from: "27820000000", interactive: { button_reply: { id: "today" } } }]);
    expect(parseMetaPayload(payload, "123456").messages.map((message) => message.selectionId)).toEqual(["reports_incidents", "today"]);
    const session = { temporary_data: { last_options: [{ id: "today", label: "Today" }] } } as unknown as SessionRow;
    expect(resolveMenuChoice(session, "today")).toBe("today");
    expect(resolveMenuChoice(session, "unlisted_command")).toBeNull();
  });
  it("rejects malformed message senders", () => {
    expect(() => parseMetaPayload(envelope([{ id: "test", from: "not-a-phone" }]), "123456")).toThrow();
  });
});

describe("Meta menus and PDF transport", () => {
  it("uses native buttons for three choices and lists for four", () => {
    const choices = Array.from({ length: 4 }, (_, i) => ({ id: String(i), label: "Choice " + i }));
    expect(metaMenuPayload(identity.phone, { lines: ["Reports"], options: choices.slice(0, 3) })).toMatchObject({ type: "interactive", interactive: { type: "button" } });
    expect(metaMenuPayload(identity.phone, { lines: ["Reports"], options: choices })).toMatchObject({ interactive: { type: "list" } });
  });
  it("uploads PDF bytes and sends a private media-ID document, retaining it for delivery", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ id: "98765" })).mockResolvedValueOnce(response({ messages: [{ id: "wamid.pdf" }] }));
    const pdf = serverPdf({ type: "incident", companyName: "TEST Company", siteName: "TEST Site", periodLabel: "Today" });
    expect(await sendMetaPdf(config, identity.phone, pdf, "report.pdf", fetcher)).toBe("wamid.pdf");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect((form.get("file") as File).type).toBe("application/pdf");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ to: "27820000000", type: "document", document: { id: "98765", filename: "report.pdf" } });
  });
  it("surfaces provider failures and deletes media when sending fails", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ id: "98765" })).mockResolvedValueOnce(response({ error: { message: "Window closed" } }, 400)).mockResolvedValueOnce(response({ success: true }));
    await expect(sendMetaPdf(config, identity.phone, new Blob(["%PDF-test"], { type: "application/pdf" }), "test.pdf", fetcher)).rejects.toBeInstanceOf(MetaError);
    expect(fetcher.mock.calls[2][1].method).toBe("DELETE");
  });
});

describe("WhatsApp report scope and PDF parity", () => {
  function client() {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    return {
      calls,
      from(table: string) {
        const query: any = {};
        for (const method of ["select", "eq", "in", "gte", "lt", "order", "range"]) query[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return query; };
        const result = { data: table === "sites" ? [{ id: "site-a", name: "TEST Site" }] : table === "companies" ? { name: "TEST Company" } : [], error: null };
        query.then = (resolve: (value: unknown) => unknown) => resolve(result);
        query.maybeSingle = async () => result;
        return query;
      },
    };
  }
  it("uses Johannesburg calendar boundaries for today and yesterday", () => {
    const now = new Date("2026-11-11T07:40:00Z");
    expect(reportWindow("today", now).from).toBe("2026-11-10T22:00:00.000Z");
    expect(reportWindow("yesterday", now)).toMatchObject({ from: "2026-11-09T22:00:00.000Z", to: "2026-11-10T22:00:00.000Z" });
  });
  it("rejects a site outside the sender's authorized sites before fetching report rows", async () => {
    const db = client();
    await expect(generateWhatsAppPdf(db, identity, "other-site", "report:incidents:summary", "today")).rejects.toThrow("Site access denied");
    expect(db.calls.some((call) => call.table === "incidents")).toBe(false);
  });
  it("restricts every report query to the tenant and resolved authorized sites", async () => {
    const db = client();
    const result = await generateWhatsAppPdf(db, identity, null, "report:incidents:summary", "today");
    expect(result.blob.type).toBe("application/pdf");
    expect(db.calls).toContainEqual({ table: "incidents", method: "eq", args: ["company_id", "company-a"] });
    expect(db.calls).toContainEqual({ table: "incidents", method: "in", args: ["site_id", ["site-a"]] });
  });
  it("denies investigation PDFs to guards", async () => {
    await expect(generateWhatsAppPdf(client(), identity, "site-a", "report:scan_investigations:summary", "today")).rejects.toThrow("Management permission required");
  });
  it("keeps all six native report outputs identical to browser reports for ASCII data", async () => {
    for (const type of ["checkpoint_scan", "device_scan", "patrol", "sos", "incident", "datalog"] as const) {
      const input = { type, companyName: "TEST Company", siteName: "TEST Site", periodLabel: "Today", generatedAt: new Date("2026-11-11T07:40:00Z") };
      expect(await serverPdf(input).text()).toBe(await browserPdf(input).text());
    }
  });
  it("produces correct byte offsets for non-ASCII company names", async () => {
    const blob = serverPdf({ type: "incident", companyName: "TEST Caf\u00e9", siteName: "Site", periodLabel: "Today" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const match = text.match(/startxref\n(\d+)/);
    expect(match).not.toBeNull();
    expect(new TextDecoder().decode(bytes.slice(Number(match?.[1]), Number(match?.[1]) + 4))).toBe("xref");
  });
});