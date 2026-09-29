import { describe, expect, it } from "vitest";
import { buildStoredZip, evidenceFilename } from "./incidentEvidencePackage";
import { buildCheckpointScanMatrix, buildDeviceScanMatrix, buildMxPdfReportBlob, buildMxPdfReportHtml, formatReportDateTime, MX_MANAGEMENT_PDF_REPORT_TYPES, MX_PATROL_REPORT_LOGO_SRC, MX_PDF_REPORT_TYPES, reportTypeFromAction } from "./mxPdfReports";

const scans = [
  { id: "1", checkpoint_id: "cp-main", tag_status: "registered", scanned_at: "2026-09-16T06:02:00.000Z", device_identifier: "Guard-01", checkpoints: { name: "Main Gate" } },
  { id: "2", checkpoint_id: "cp-lobby", tag_status: "registered", scanned_at: "2026-09-16T07:10:00.000Z", device_identifier: "Guard-01", checkpoints: { name: "Lobby" } },
  { id: "3", checkpoint_id: "cp-main", tag_status: "registered", scanned_at: "2026-09-16T08:05:00.000Z", device_identifier: "Guard-02", checkpoints: { name: "Main Gate" } },
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
      { id: "scan-1", checkpoint_id: "cp-gate", tag_status: "registered", scanned_at: "2026-09-26T07:52:00.000Z", device_identifier: "RG360-001", checkpoints: { name: "Gate" } },
      { id: "scan-2", checkpoint_id: "cp-sitting", tag_status: "registered", scanned_at: "2026-09-26T14:21:00.000Z", device_identifier: "RG360-001", checkpoints: { name: "sittingRoom" } },
      { id: "scan-3", checkpoint_id: "cp-kitchen", tag_status: "registered", scanned_at: "2026-09-26T02:15:00.000Z", device_identifier: "RG360-001", checkpoints: { name: "kitchen" } },
    ];
    const matrix = buildCheckpointScanMatrix(todayScans, checkpoints, { oneDay: true });
    expect(matrix.columns).toHaveLength(24);
    expect(matrix.columns[0]).toBe("00:00");
    expect(matrix.columns[matrix.columns.length - 1]).toBe("23:00");
    expect(matrix.columns).toContain("04:00");
    expect(matrix.rows.find((row) => row.label === "Gate")?.cells.flat()).toContain("09:52");
    expect(matrix.rows.find((row) => row.label === "kitchen")?.cells.flat()).toContain("04:15");
    expect(matrix.rows.find((row) => row.label === "Gate")?.cells.flat().join(" ")).not.toContain("2026");

    const blob = buildMxPdfReportBlob({ type: "checkpoint_scan", companyName: "Acme", siteName: "Tlokweng", periodLabel: "Today", scans: [], checkpoints });
    const pdf = new TextDecoder().decode(await blob.arrayBuffer());
    expect(pdf).toContain("/Count 1");
    expect(pdf).not.toContain("Columns 1 of");
    expect(pdf).toContain("00:00");
    expect(pdf).toContain("23:00");
  });


  it("simplifies patrol report status columns in HTML preview and PDF", async () => {
    const patrols = [
      { patrol_name: "House Patrol", status: "completed", scheduled_start: "2026-09-26T06:00:00.000Z", actual_start: "2026-09-26T06:00:00.000Z", actual_end: "2026-09-26T06:45:00.000Z", checkpoint_completed: 6, checkpoint_total: 6, sites: { name: "Tlokweng" } },
      { patrol_name: "Night Patrol", status: "late_start", scheduled_start: "2026-09-26T12:00:00.000Z", actual_start: "2026-09-26T12:10:00.000Z", actual_end: "2026-09-26T12:58:00.000Z", checkpoint_completed: 6, checkpoint_total: 6, sites: { name: "Tlokweng" } },
      { patrol_name: "Evening Patrol", status: "incomplete", scheduled_start: "2026-09-26T17:00:00.000Z", actual_start: "2026-09-26T17:00:00.000Z", checkpoint_completed: 2, checkpoint_total: 6, sites: { name: "Tlokweng" } },
      { patrol_name: "Perimeter Patrol", status: "missed", scheduled_start: "2026-09-26T20:00:00.000Z", checkpoint_completed: 0, checkpoint_total: 6, sites: { name: "Tlokweng" } },
    ];
    const input = { type: "patrol" as const, companyName: "Acme", siteName: "Tlokweng", periodLabel: "Today", patrols };
    const html = buildMxPdfReportHtml(input);

    expect(html).toContain("<th>Status</th>");
    expect(html).toContain("<th>Checkpoints</th>");
    expect(html).toContain("<th>Missed Checkpoints</th>");
    expect(html).toContain("<th>Late Time</th>");
    expect(html).not.toContain("<th>Completed</th>");
    expect(html).not.toContain("<th>Incomplete</th>");
    expect(html).not.toContain("<th>Missed</th>");
    expect(html).not.toContain("<th>Late</th>");
    expect(html).toContain("<td>Completed</td>");
    expect(html).toContain("<td>Late</td>");
    expect(html).toContain("<td>Incomplete</td>");
    expect(html).toContain("<td>Missed</td>");
    expect(html).toContain("<td>6 / 6</td>");
    expect(html).toContain("<td>2 / 6</td>");
    expect(html).toContain("<td>4</td>");
    expect(html).toContain("<td>10 min</td>");

    const pdf = new TextDecoder().decode(await buildMxPdfReportBlob(input).arrayBuffer());
    expect(pdf).toContain("Completion Time");
    expect(pdf).toContain("Missed Checkpoints");
    expect(pdf).toContain("Late Time");
    expect(pdf).toContain("6 / 6");
    expect(pdf).toContain("10 min");
  });

  it("excludes unregistered and pending checkpoint scans from standard reports while preserving investigations", () => {
    const mixedScans = [
      { id: "registered", checkpoint_id: "cp-gate", tag_status: "registered", scanned_at: "2026-09-26T07:52:00.000Z", device_identifier: "RG360-001", tag_uid: "REG-1", checkpoints: { name: "Gate" } },
      { id: "unregistered", checkpoint_id: null, tag_status: "unregistered", scanned_at: "2026-09-26T08:10:00.000Z", device_identifier: "RG360-002", tag_uid: "UNKNOWN-1", checkpoint_name: "Unregistered checkpoint" },
      { id: "pending", checkpoint_id: null, tag_status: "pending_registration", scanned_at: "2026-09-26T09:10:00.000Z", device_identifier: "RG360-003", tag_uid: "PENDING-1", checkpoint_name: "Pending checkpoint" },
      { id: "ignored", checkpoint_id: null, tag_status: "ignored", scanned_at: "2026-09-26T10:10:00.000Z", device_identifier: "RG360-004", tag_uid: "IGNORED-1", checkpoint_name: "Ignored checkpoint" },
    ];

    const checkpointHtml = buildMxPdfReportHtml({ type: "checkpoint_scan", companyName: "Acme", siteName: "Tlokweng", periodLabel: "Today", scans: mixedScans });
    expect(checkpointHtml).toContain("Gate");
    expect(checkpointHtml).not.toContain("Unregistered checkpoint");
    expect(checkpointHtml).not.toContain("Pending checkpoint");
    expect(checkpointHtml).not.toContain("Ignored checkpoint");

    const deviceHtml = buildMxPdfReportHtml({ type: "device_scan", companyName: "Acme", siteName: "Tlokweng", periodLabel: "Today", scans: mixedScans });
    expect(deviceHtml).toContain("RG360-001");
    expect(deviceHtml).not.toContain("RG360-002");
    expect(deviceHtml).not.toContain("Unregistered checkpoint");

    const datalogHtml = buildMxPdfReportHtml({
      type: "datalog",
      companyName: "Acme",
      siteName: "Tlokweng",
      periodLabel: "Today",
      datalogs: [
        { id: "dl-registered", checkpoint_id: "cp-gate", submitted_at: "2026-09-26T07:53:00.000Z", datalog_value: "Gate locked", checkpoints: { name: "Gate" } },
        { id: "dl-unregistered", checkpoint_id: null, submitted_at: "2026-09-26T08:53:00.000Z", datalog_value: "Temporary reading", checkpoint_name: "Unregistered checkpoint" },
      ],
    });
    expect(datalogHtml).toContain("Gate locked");
    expect(datalogHtml).not.toContain("Temporary reading");

    const investigationHtml = buildMxPdfReportHtml({ type: "scan_investigations", companyName: "Acme", siteName: "Tlokweng", periodLabel: "Today", scans: mixedScans });
    expect(investigationHtml).toContain("UNKNOWN-1");
    expect(investigationHtml).toContain("PENDING-1");
    expect(investigationHtml).toContain("IGNORED-1");
  });
  it("keeps Scan Investigations management-only and renders raw scan-log forensic fields", async () => {
    expect(MX_PDF_REPORT_TYPES.some((report) => report.type === "scan_investigations")).toBe(false);
    expect(MX_MANAGEMENT_PDF_REPORT_TYPES.some((report) => report.type === "scan_investigations")).toBe(true);
    expect(reportTypeFromAction("report:scan_investigations:summary")).toBe("scan_investigations");

    const investigationScans = [{
      id: "scan-1",
      scanned_at: "2026-09-26T07:52:00.000Z",
      created_at: "2026-09-26T07:53:00.000Z",
      company_id: "company-1",
      site_id: "site-1",
      checkpoint_id: "checkpoint-1",
      device_id: "device-1",
      device_identifier: "RG360-01",
      tag_uid: "04AABBCC",
      tag_status: "unregistered",
      patrol_match_status: "wrong_patrol",
      patrol_validation_status: "investigation",
      data_log_status: "captured",
      is_offline_sync: true,
      client_scan_id: "client-scan-1",
      gps_lat: -24.6479,
      gps_lng: 25.9147,
      gps_accuracy: 4,
      sites: { name: "Tlokweng" },
      checkpoints: { name: "Generator Room", nfc_tag_id: "04AABBCC" },
      patrol_sessions: { id: "session-1", patrol_routes: { name: "Night Patrol" } },
      data_log_submissions: [{ datalog_value: "Meter 245" }],
    }];

    const input = { type: "scan_investigations" as const, companyName: "Acme", siteName: "Tlokweng", periodLabel: "Today", scans: investigationScans };
    const html = buildMxPdfReportHtml(input);
    expect(html).toContain("Scan Investigations");
    expect(html).toContain("Forensic scan log audit");
    expect(html).toContain("RG360-01");
    expect(html).toContain("Generator Room");
    expect(html).toContain("04AABBCC");
    expect(html).toContain("Unregistered / Wrong Patrol / Investigation / Captured");
    expect(html).toContain("<td>Yes</td>");
    expect(html).toContain("Total Scan Rows: 1");

    const pdf = new TextDecoder().decode(await buildMxPdfReportBlob(input).arrayBuffer());
    expect(pdf).toContain("Scan Investigations");
    expect(pdf).toContain("Scan #1");
    expect(pdf).toContain("04AABBCC");
    expect(pdf).toContain("GPS: -24.6479,");
    expect(pdf).toContain("25.9147 \\(+/-4m\\)");
    expect(pdf).toContain("Datalog:");
    expect(pdf).toContain("Meter 245");
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
