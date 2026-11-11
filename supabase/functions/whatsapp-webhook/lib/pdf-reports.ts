import type { Identity } from "./types.ts";
import { allowedSites } from "./identity.ts";
import { buildMxPdfReportBlob, buildMxPdfReportResult, type MxPdfReportInput, type MxPdfReportType } from "../../_shared/whatsapp/pdf.ts";

const ACTION_TYPES: Record<string, MxPdfReportType> = {
  "report:checkpoint_scans:matrix": "checkpoint_scan",
  "report:devices:activity": "device_scan",
  "report:patrols:summary": "patrol",
  "report:sos:summary": "sos",
  "report:incidents:summary": "incident",
  "report:data_logs:values": "datalog",
  "report:scan_investigations:summary": "scan_investigations",
};
export function pdfTypeForAction(action: string): MxPdfReportType | null { return ACTION_TYPES[action] ?? null; }

export function reportWindow(period: "today" | "yesterday" | "week", now = new Date()) {
  const localDay = new Date(now.getTime() + 2 * 3600000).toISOString().slice(0, 10);
  const midnight = new Date(localDay + "T00:00:00+02:00");
  const start = new Date(midnight);
  if (period === "yesterday") start.setUTCDate(start.getUTCDate() - 1);
  if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
  return { from: start.toISOString(), to: (period === "yesterday" ? midnight : now).toISOString(), label: period === "week" ? "Last 7 Days" : period === "today" ? "Today" : "Yesterday" };
}

export async function generateWhatsAppPdf(client: any, identity: Identity, siteId: string | null, action: string, period: "today" | "yesterday" | "week") {
  const type = pdfTypeForAction(action);
  if (!type) throw new Error("Unsupported PDF report");
  if (type === "scan_investigations" && !identity.canManage) throw new Error("Management permission required");
  const sites: Array<{ id: string; name: string }> = await allowedSites(client, identity);
  if (siteId && !sites.some((site) => site.id === siteId)) throw new Error("Site access denied");
  if (!sites.length) throw new Error("No authorized sites for this report");
  const ids = siteId ? [siteId] : sites.map((site) => site.id);
  const window = reportWindow(period);
  const scoped = (query: any) => query.eq("company_id", identity.company_id).in("site_id", ids);
  const rows = async (table: string, select: string, timestamp: string) => {
    const all: any[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await scoped(client.from(table).select(select)).gte(timestamp, window.from).lt(timestamp, window.to).order(timestamp).order("id").range(offset, offset + 499);
      if (result.error) throw new Error(`Report data unavailable: ${result.error.message}`);
      all.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < 500) return all;
      if (all.length >= 10000) throw new Error("Report is too large; choose one site or a shorter period");
    }
  };
  const company = await client.from("companies").select("name").eq("id", identity.company_id).maybeSingle();
  if (company.error) throw new Error("Company lookup failed");
  const input: MxPdfReportInput = { type, companyName: company.data?.name ?? "MX Patrol", siteName: siteId ? sites.find((site) => site.id === siteId)?.name ?? "Site" : "Authorized Sites", periodLabel: window.label };
  if (["checkpoint_scan", "device_scan", "scan_investigations"].includes(type)) {
    input.scans = await rows("scan_logs", "*, checkpoints(name), sites(name)", "scanned_at");
  } else if (type === "patrol") {
    input.patrols = await rows("patrol_session_reports", "*", "scheduled_start");
  } else if (type === "sos") {
    input.alerts = await rows("alerts", "*, sites(name)", "created_at");
  } else if (type === "incident") {
    input.incidents = await rows("incidents", "*, sites(name)", "created_at");
  } else {
    input.datalogs = await rows("data_log_submissions", "*, checkpoints(name), sites(name)", "submitted_at");
  }
  return { blob: buildMxPdfReportBlob(input), filename: buildMxPdfReportResult(input).filename };
}