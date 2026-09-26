import { describe, expect, it } from "vitest";
import { buildStoredZip, evidenceFilename } from "./incidentEvidencePackage";
import { buildCheckpointScanMatrix, buildDeviceScanMatrix, buildMxPdfReportBlob, buildMxPdfReportHtml, formatReportDateTime, MX_PATROL_REPORT_LOGO_SRC } from "./mxPdfReports";

const scans = [
  { id: "1", scanned_at: "2026-09-16T06:02:00.000Z", device_identifier: "Guard-01", checkpoints: { name: "Main Gate" } },
  { id: "2", scanned_at: "2026-09-16T07:10:00.000Z", device_identifier: "Guard-01", checkpoints: { name: "Lobby" } },
  { id: "3", scanned_at: "2026-09-16T08:05:00.000Z", device_identifier: "Guard-02", checkpoints: { name: "Main Gate" } },
];

describe("MX PDF report helpers", () => {
  it("formats local date and time for report timestamps", () => {
    expect(formatReportDateTime("2026-09-16T06:42:00.000Z")).toContain("16 Sept 2026");
    expect(formatReportDateTime("2026-09-16T06:42:00.000Z")).toContain("08:42");
  });

  it("maps checkpoint scan report as checkpoint rows by time columns", () => {
    const matrix = buildCheckpointScanMatrix(scans);
    expect(matrix.columns).toContain("08:00");
    const mainGate = matrix.rows.find((row) => row.label === "Main Gate");
    expect(mainGate?.cells.flat().join(" ")).toContain("08:02");
    expect(mainGate?.cells.flat().join(" ")).toContain("10:05");
  });

  it("maps device scan report as device rows by checkpoint columns", () => {
    const matrix = buildDeviceScanMatrix(scans);
    expect(matrix.columns).toEqual(["Lobby", "Main Gate"]);
    const guard = matrix.rows.find((row) => row.label === "Guard-01");
    expect(guard?.cells.flat().join(" ")).toContain("08:02");
    expect(guard?.cells.flat().join(" ")).toContain("09:10");
  });

  it("builds report HTML with the production TTECH MX Patrol logo", () => {
    const html = buildMxPdfReportHtml({ type: "checkpoint_scan", companyName: "Acme", siteName: "Main Office", periodLabel: "Today", scans });
    expect(MX_PATROL_REPORT_LOGO_SRC).toBe("/branding/ttech-mxpatrol-logo.png");
    expect(html).toContain('src="/branding/ttech-mxpatrol-logo.png"');
    expect(html).toContain('alt="TTECH MX Patrol"');
    expect(html).not.toContain('<div class="shield">MX</div>');
    expect(html).toContain("Checkpoint Scan Report");
    expect(html).toContain("Report Period:");
  });

  it("keeps checkpoint and device report table headings when today's scan rows are empty", () => {
    const checkpoints = [{ id: "gate", name: "Main Gate" }, { id: "lobby", name: "Lobby" }];
    const checkpointHtml = buildMxPdfReportHtml({ type: "checkpoint_scan", companyName: "Acme", siteName: "Main Office", periodLabel: "Today", scans: [], checkpoints });
    expect(checkpointHtml).toContain("<th>Checkpoint</th>");
    expect(checkpointHtml).toContain("<th>08:00</th>");
    expect(checkpointHtml).toContain("Main Gate");

    const deviceHtml = buildMxPdfReportHtml({ type: "device_scan", companyName: "Acme", siteName: "Main Office", periodLabel: "Today", scans: [], checkpoints });
    expect(deviceHtml).toContain("<th>Device</th>");
    expect(deviceHtml).toContain("<th>Main Gate</th>");
    expect(deviceHtml).toContain("<th>Lobby</th>");
  });

  it("fits a normal checkpoint scan report on one PDF page with all hourly columns", async () => {
    const checkpoints = ["AI Verify Checkpoint", "Gate", "bedRoom", "kitchen", "sittingRoom"].map((name) => ({ name }));
    const todayScans = [
      { id: "scan-1", scanned_at: "2026-09-26T07:52:00.000Z", device_identifier: "RG360-001", checkpoints: { name: "Gate" } },
      { id: "scan-2", scanned_at: "2026-09-26T14:21:00.000Z", device_identifier: "RG360-001", checkpoints: { name: "sittingRoom" } },
    ];
    const matrix = buildCheckpointScanMatrix(todayScans, checkpoints, { oneDay: true });
    expect(matrix.columns).toHaveLength(18);
    expect(matrix.columns[0]).toBe("06:00");
    expect(matrix.columns[matrix.columns.length - 1]).toBe("23:00");
    expect(matrix.rows.find((row) => row.label === "Gate")?.cells.flat()).toContain("09:52");
    expect(matrix.rows.find((row) => row.label === "Gate")?.cells.flat().join(" ")).not.toContain("2026");

    const blob = buildMxPdfReportBlob({ type: "checkpoint_scan", companyName: "Acme", siteName: "Tlokweng", periodLabel: "Today", scans: [], checkpoints });
    const pdf = new TextDecoder().decode(await blob.arrayBuffer());
    expect(pdf).toContain("/Count 1");
    expect(pdf).not.toContain("Columns 1 of");
    expect(pdf).toContain("06:00");
    expect(pdf).toContain("23:00");
  });

  it("adds incident evidence pages with photo previews and audio metadata", () => {
    const html = buildMxPdfReportHtml({
      type: "incident",
      companyName: "Acme",
      siteName: "Main Office",
      periodLabel: "Today",
      incidents: [{ id: "00421abcdef", created_at: "2026-09-16T18:14:00.000Z", title: "Gate issue", description: "Evidence photo | company/site/photo.jpg", severity: "high", resolved: false, device_identifier: "Guard-01" }],
      incidentEvidence: {
        "00421abcdef": {
          photos: [{ incident_id: "00421abcdef", storage_path: "company/site/photo.jpg", signed_url: "https://example.test/photo.jpg", captured_at: "2026-09-16T18:14:00.000Z", device_identifier: "Guard-01" }],
          audio: [{ incident_id: "00421abcdef", storage_path: "company/site/audio.m4a", captured_at: "2026-09-16T18:15:00.000Z", device_identifier: "Guard-01", duration_seconds: 42 }],
        },
      },
    });
    expect(html).toContain("Attached Evidence");
    expect(html).toContain("Photo 1");
    expect(html).toContain("photo.jpg");
    expect(html).toContain("audio.m4a");
    expect(html).toContain("00:42");
  });

  it("keeps incident reports usable when no evidence is attached", () => {
    const html = buildMxPdfReportHtml({ type: "incident", companyName: "Acme", siteName: "Main Office", periodLabel: "Today", incidents: [{ id: "no-evidence", created_at: "2026-09-16T18:14:00.000Z", title: "No evidence", resolved: false }] });
    expect(html).toContain("No attached photos for this report.");
    expect(html).toContain("No attached audio");
  });

  it("builds a stored ZIP package with requested evidence paths", async () => {
    const zip = buildStoredZip([{ path: "INC-00421/Photos/photo.jpg", bytes: new Uint8Array([1, 2, 3]) }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("INC-00421/Photos/photo.jpg");
    expect(evidenceFilename("company/site/audio.m4a")).toBe("audio.m4a");
  });
});
