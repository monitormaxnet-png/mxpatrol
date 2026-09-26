export type MxPdfReportType = "checkpoint_scan" | "device_scan" | "patrol" | "sos" | "incident" | "datalog";

export type MxPdfEvidencePhoto = {
  id?: string;
  incident_id?: string | null;
  storage_path: string;
  signed_url?: string | null;
  filename?: string | null;
  device_identifier?: string | null;
  captured_at?: string | null;
  created_at?: string | null;
};

export type MxPdfEvidenceAudio = {
  id?: string;
  incident_id?: string | null;
  storage_path?: string | null;
  signed_url?: string | null;
  filename?: string | null;
  device_identifier?: string | null;
  captured_at?: string | null;
  created_at?: string | null;
  duration_seconds?: number | null;
};

export type MxPdfIncidentEvidence = {
  photos?: MxPdfEvidencePhoto[];
  audio?: MxPdfEvidenceAudio[];
};

export type MxPdfReportInput = {
  type: MxPdfReportType;
  companyName: string;
  siteName: string;
  periodLabel: string;
  generatedAt?: Date;
  scans?: any[];
  patrols?: any[];
  alerts?: any[];
  incidents?: any[];
  datalogs?: any[];
  checkpoints?: any[];
  incidentEvidence?: Record<string, MxPdfIncidentEvidence>;
};

export const MX_PDF_REPORT_TYPES: Array<{ type: MxPdfReportType; label: string; action: string }> = [
  { type: "checkpoint_scan", label: "Checkpoint Scan Report", action: "report:checkpoint_scan" },
  { type: "device_scan", label: "Device Scan Report", action: "report:device_scan" },
  { type: "patrol", label: "Patrol Report", action: "report:patrol" },
  { type: "sos", label: "SOS Report", action: "report:sos" },
  { type: "incident", label: "Incident Report", action: "report:incident" },
  { type: "datalog", label: "Datalog Report", action: "report:datalog" },
];

const TZ = "Africa/Johannesburg";
export const MX_PATROL_REPORT_LOGO_SRC = "/branding/ttech-mxpatrol-logo.png";
const MX_PATROL_REPORT_TAGLINE = "Security Technology for a Safer Tomorrow";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));

export function formatReportDateTime(value?: string | Date | null): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(date).replace(",", " -");
}

function reportTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(date);
}

function reportDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }).format(date);
}

function compactScanCellTime(value?: string | null, oneDay = false): string {
  if (!value) return "-";
  const time = reportTime(value);
  if (oneDay) return time;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return time;
  const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: TZ }).format(date).replace(/\s/g, " ");
  return day + " " + time;
}

function isOneDayReportPeriod(periodLabel?: string | null): boolean {
  const label = String(periodLabel ?? "").toLowerCase();
  return label === "today" || label === "yesterday" || /^\d{1,2}\s+[a-z]{3,}\s+\d{4}$/.test(label);
}
function timeBucket(value?: string | null): string {
  const time = reportTime(value);
  return time === "-" ? "Unknown" : `${time.slice(0, 2)}:00`;
}

function checkpointName(row: any): string {
  return row?.checkpoints?.name ?? row?.checkpoint_name_snapshot ?? row?.checkpoint_name ?? "Unassigned checkpoint";
}

function deviceName(row: any): string {
  return row?.device_identifier ?? row?.devices?.device_identifier ?? row?.device_name ?? row?.device_id ?? "Unknown device";
}

function incidentId(row: any): string {
  const raw = String(row?.incident_number ?? row?.incident_id ?? row?.id ?? "").trim();
  return raw ? (raw.startsWith("INC-") ? raw : `INC-${raw.slice(0, 8).toUpperCase()}`) : "INC-UNKNOWN";
}

function filenameFromPath(path?: string | null): string {
  if (!path) return "Evidence file";
  return path.split("/").filter(Boolean).pop() ?? path;
}

function incidentEvidenceFor(input: MxPdfReportInput, row: any): Required<MxPdfIncidentEvidence> {
  const key = String(row?.id ?? row?.incident_id ?? incidentId(row));
  const evidence = input.incidentEvidence?.[key] ?? input.incidentEvidence?.[incidentId(row)] ?? {};
  return { photos: evidence.photos ?? [], audio: evidence.audio ?? [] };
}

function durationLabel(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function evidenceCounts(input: MxPdfReportInput, row: any) {
  const evidence = incidentEvidenceFor(input, row);
  return { photos: evidence.photos.length, audio: evidence.audio.length };
}
function siteName(row: any): string {
  return row?.sites?.name ?? row?.site_name ?? row?.checkpoints?.sites?.name ?? "Unassigned site";
}

function statusText(value: unknown): string {
  return String(value ?? "-").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

const DEFAULT_CHECKPOINT_SCAN_TIME_COLUMNS = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"];

function checkpointOptionName(checkpoint: any): string {
  return String(checkpoint?.name ?? checkpoint?.checkpoint_name ?? checkpoint?.checkpoint_name_snapshot ?? "Checkpoint");
}

export function buildCheckpointScanMatrix(scans: any[], checkpoints: any[] = [], options: { oneDay?: boolean } = {}) {
  const checkpointNames = new Set<string>();
  checkpoints.forEach((checkpoint) => checkpointNames.add(checkpointOptionName(checkpoint)));
  scans.forEach((scan) => checkpointNames.add(checkpointName(scan)));
  const scannedColumns = Array.from(new Set(scans.map((scan) => timeBucket(scan.scanned_at)))).sort();
  const columns = options.oneDay ? DEFAULT_CHECKPOINT_SCAN_TIME_COLUMNS : scannedColumns.length ? scannedColumns : DEFAULT_CHECKPOINT_SCAN_TIME_COLUMNS;
  const rows = Array.from(checkpointNames).sort().map((checkpoint) => {
    const cells = columns.map((column) => scans
      .filter((scan) => checkpointName(scan) === checkpoint && timeBucket(scan.scanned_at) === column)
      .map((scan) => compactScanCellTime(scan.scanned_at, options.oneDay)));
    return { label: checkpoint, cells };
  });
  return { columns, rows };
}

export function buildDeviceScanMatrix(scans: any[], checkpoints: any[] = [], options: { oneDay?: boolean } = {}) {
  const devices = Array.from(new Set(scans.map(deviceName))).sort();
  const configuredCheckpointNames = checkpoints.map(checkpointOptionName).filter(Boolean);
  const scannedCheckpointNames = scans.map(checkpointName);
  const columns = Array.from(new Set([...configuredCheckpointNames, ...scannedCheckpointNames])).sort();
  const rows = devices.map((device) => {
    const cells = columns.map((checkpoint) => scans
      .filter((scan) => deviceName(scan) === device && checkpointName(scan) === checkpoint)
      .map((scan) => compactScanCellTime(scan.scanned_at, options.oneDay)));
    return { label: device, cells };
  });
  return { columns, rows };
}

function table(headers: string[], rows: string[][]): string {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell || "-"}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">No records match this report.</td></tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function matrixTable(firstHeader: string, columns: string[], rows: Array<{ label: string; cells: string[][] }>): string {
  return table([firstHeader, ...columns], rows.map((row) => [escapeHtml(row.label), ...row.cells.map((values) => values.length ? values.map(escapeHtml).join("<br>") : "-")]));
}

function lateDuration(row: any): string {
  if (!row?.scheduled_start || !row?.actual_start) return "-";
  const diff = new Date(row.actual_start).getTime() - new Date(row.scheduled_start).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return "-";
  const minutes = Math.round(diff / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function contentFor(input: MxPdfReportInput): { title: string; subtitle: string; html: string; totals: string } {
  const scans = input.scans ?? [];
  const patrols = input.patrols ?? [];
  const alerts = input.alerts ?? [];
  const incidents = input.incidents ?? [];
  const datalogs = input.datalogs ?? [];

  if (input.type === "checkpoint_scan") {
    const matrix = buildCheckpointScanMatrix(scans, input.checkpoints ?? [], { oneDay: isOneDayReportPeriod(input.periodLabel) });
    return { title: "Checkpoint Scan Report", subtitle: "Checkpoint scans by time", html: matrixTable("Checkpoint", matrix.columns, matrix.rows), totals: `Total Checkpoints: ${matrix.rows.length}` };
  }
  if (input.type === "device_scan") {
    const matrix = buildDeviceScanMatrix(scans, input.checkpoints ?? [], { oneDay: isOneDayReportPeriod(input.periodLabel) });
    return { title: "Device Scan Report", subtitle: "Device scans by checkpoint", html: matrixTable("Device", matrix.columns, matrix.rows), totals: `Total Devices: ${matrix.rows.length}` };
  }
  if (input.type === "patrol") {
    const rows = patrols.map((row, index) => [
      String(index + 1),
      escapeHtml(row.patrol_name ?? row.patrol_routes?.name ?? row.patrol_templates?.name ?? "Patrol"),
      escapeHtml(siteName(row)),
      escapeHtml(reportDate(row.scheduled_start)),
      escapeHtml(reportTime(row.scheduled_start)),
      escapeHtml(reportTime(row.actual_start)),
      escapeHtml(reportTime(row.actual_end ?? row.finalized_at ?? row.completed_at)),
      escapeHtml(statusText(row.status)),
      escapeHtml(row.checkpoint_completed ?? row.completed_checkpoints ?? 0),
      escapeHtml(row.missed_checkpoint_count ?? Math.max((row.checkpoint_total ?? row.expected_checkpoints ?? 0) - (row.checkpoint_completed ?? row.completed_checkpoints ?? 0), 0)),
      escapeHtml(lateDuration(row)),
    ]);
    return { title: "Patrol Report", subtitle: "Patrol performance summary", html: table(["#", "Patrol Name", "Site", "Date", "Scheduled Time", "Actual Start", "Completion", "Status", "Completed", "Missed", "Late"], rows), totals: `Total Patrols: ${rows.length}` };
  }
  if (input.type === "sos") {
    const sos = alerts.filter((alert) => String(alert.type ?? "").includes("panic") || String(alert.title ?? "").toLowerCase().includes("sos"));
    const rows = sos.map((row, index) => [String(index + 1), escapeHtml(formatReportDateTime(row.created_at)), escapeHtml(siteName(row)), escapeHtml(deviceName(row)), escapeHtml(row.is_read ? "Resolved" : "Active"), escapeHtml(reportTime(row.acknowledged_at ?? row.updated_at)), escapeHtml(reportTime(row.resolved_at)), escapeHtml(row.duration_minutes ?? "-")]);
    return { title: "SOS Report", subtitle: "SOS events and response", html: table(["#", "Date & Time", "Site", "Device", "SOS Status", "Response Time", "Resolved Time", "Duration"], rows), totals: `Total SOS: ${rows.length}` };
  }
  if (input.type === "incident") {
    const rows = incidents.map((row, index) => {
      const counts = evidenceCounts(input, row);
      return [
        String(index + 1),
        escapeHtml(incidentId(row)),
        escapeHtml(formatReportDateTime(row.created_at)),
        escapeHtml(siteName(row)),
        escapeHtml(deviceName(row)),
        escapeHtml(row.incident_type ?? row.type ?? "Incident"),
        escapeHtml(row.severity ?? row.priority ?? "Normal"),
        escapeHtml(row.title ?? row.description ?? row.message ?? "-"),
        escapeHtml(row.resolved ? "Resolved" : "Open"),
        escapeHtml(reportTime(row.resolved_at ?? row.updated_at)),
        escapeHtml(counts.photos),
        escapeHtml(counts.audio),
      ];
    });
    return { title: "Incident Report", subtitle: "Security incident details", html: table(["#", "Incident ID", "Date & Time", "Site", "Device", "Incident Type", "Priority", "Description", "Status", "Resolved Time", "Photos", "Audio"], rows), totals: `Total Incidents: ${rows.length}` };
  }
  const rows = datalogs.map((row, index) => [String(index + 1), escapeHtml(formatReportDateTime(row.submitted_at ?? row.created_at)), escapeHtml(siteName(row)), escapeHtml(row.checkpoints?.name ?? row.checkpoint_name ?? "Checkpoint"), escapeHtml(deviceName(row)), escapeHtml(row.datalog_value ?? row.responses_json?.datalog_value ?? row.responses_json?.value ?? "-")]);
  return { title: "Datalog Report", subtitle: "Checkpoint datalog entries", html: table(["#", "Date & Time", "Site", "Checkpoint", "Device", "Datalog Text"], rows), totals: `Total Datalog Entries: ${rows.length}` };
}

function buildIncidentEvidenceHtml(input: MxPdfReportInput): string {
  if (input.type !== "incident") return "";
  const incidents = input.incidents ?? [];
  const cards: string[] = [];
  const audioRows: string[][] = [];

  incidents.forEach((incident, incidentIndex) => {
    const id = incidentId(incident);
    const evidence = incidentEvidenceFor(input, incident);
    evidence.photos.forEach((photo, photoIndex) => {
      const captured = photo.captured_at ?? photo.created_at ?? incident.created_at;
      cards.push(`<article class="photo-card">${photo.signed_url ? `<img src="${escapeHtml(photo.signed_url)}" alt="Evidence photo ${photoIndex + 1} for ${escapeHtml(id)}">` : `<div class="photo-empty">Photo</div>`}<h4>Photo ${photoIndex + 1}</h4><p>${escapeHtml(formatReportDateTime(captured))}</p><p><b>Incident:</b> ${escapeHtml(id)}</p><p><b>Device:</b> ${escapeHtml(photo.device_identifier ?? deviceName(incident))}</p><p class="file-name">${escapeHtml(photo.filename ?? filenameFromPath(photo.storage_path))}</p></article>`);
    });
    evidence.audio.forEach((audio, audioIndex) => {
      const captured = audio.captured_at ?? audio.created_at ?? incident.created_at;
      audioRows.push([
        String(audioRows.length + 1),
        escapeHtml(formatReportDateTime(captured)),
        escapeHtml(id),
        escapeHtml(audio.device_identifier ?? deviceName(incident)),
        escapeHtml(durationLabel(audio.duration_seconds)),
        escapeHtml(audio.filename ?? filenameFromPath(audio.storage_path)),
      ]);
    });
    if (evidence.photos.length === 0 && evidence.audio.length === 0) {
      audioRows.push([String(audioRows.length + 1), escapeHtml(formatReportDateTime(incident.created_at)), escapeHtml(id), escapeHtml(deviceName(incident)), "-", "No attached audio"]);
    }
    if (incidentIndex < incidents.length - 1 && evidence.photos.length) cards.push('<div class="incident-divider"></div>');
  });

  const totalPhotos = cards.filter((card) => card.includes("photo-card")).length;
  const totalAudio = audioRows.filter((row) => row[5] !== "No attached audio").length;
  return `<section class="evidence-section"><div class="section-title"><div><h2>Attached Evidence</h2><p>Photos and audio recordings linked to this incident report</p></div><span>${totalPhotos} Photo(s) · ${totalAudio} Audio Recording(s)</span></div><h3>Photos</h3>${totalPhotos ? `<div class="photo-grid">${cards.join("")}</div>` : `<p class="empty-evidence">No attached photos for this report.</p>`}<h3>Audio Recordings</h3>${table(["#", "Date & Time", "Incident", "Device", "Duration", "Filename"], audioRows)}</section>`;
}
export function buildMxPdfReportHtml(input: MxPdfReportInput): string {
  const generatedAt = input.generatedAt ?? new Date();
  const content = contentFor(input);
  const evidenceHtml = buildIncidentEvidenceHtml(input);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(content.title)}</title><style>
    @page { size: A4 landscape; margin: 11mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #08254a; font-family: Arial, Helvetica, sans-serif; background: #fff; overflow: auto; }
    .page { min-height: 186mm; min-width: 980px; display: flex; flex-direction: column; }
    header { display: grid; grid-template-columns: 1fr 1.2fr; gap: 24px; align-items: start; border-bottom: 3px solid #0d477d; padding-bottom: 12px; }
    .brand { display: flex; align-items: center; min-height: 72px; }
    .brand-logo { width: 172px; max-height: 76px; object-fit: contain; object-position: left center; }
    .meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 11px; }
    .meta b { color: #0a2f5f; }
    .title { margin: 20px 0 12px; display: flex; justify-content: space-between; gap: 20px; }
    .title h2 { margin: 0; color: #0a2f5f; font-size: 24px; }
    .title p { margin: 3px 0 0; font-size: 14px; color: #064989; }
    table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; table-layout: auto; font-size: 10px; }
    th { position: sticky; top: 0; z-index: 3; min-width: 108px; background: #0a376a; color: #fff; padding: 8px 6px; text-align: left; border: 1px solid #7ea4c7; }
    td { min-width: 108px; padding: 7px 6px; border: 1px solid #c8d8e8; vertical-align: top; color: #102a43; overflow-wrap: anywhere; word-break: normal; }
    th:first-child, td:first-child { position: sticky; left: 0; min-width: 150px; max-width: 220px; z-index: 2; }
    th:first-child { z-index: 4; }
    td:first-child { background: #fff; font-weight: 700; color: #08254a; }
    tbody tr:nth-child(even) td { background: #f6fbff; }
    tbody tr:nth-child(even) td:first-child { background: #f6fbff; }
    .totals { margin-top: 14px; padding: 10px 14px; background: #eef6fd; border-radius: 4px; font-weight: 800; color: #0a2f5f; }
    .evidence-section { page-break-before: always; margin-top: 18px; }
    .section-title { display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-bottom: 14px; padding: 10px 12px; background: #eef6fd; border-radius: 4px; }
    .section-title h2 { margin: 0; color: #0a2f5f; font-size: 22px; }
    .section-title p { margin: 3px 0 0; color: #064989; font-size: 12px; }
    .section-title span { font-size: 12px; font-weight: 800; color: #0a2f5f; white-space: nowrap; }
    .evidence-section h3 { margin: 14px 0 8px; color: #0a2f5f; font-size: 16px; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .photo-card { break-inside: avoid; border: 1px solid #c8d8e8; border-radius: 4px; padding: 8px; background: #fff; }
    .photo-card img, .photo-empty { width: 100%; height: 118px; object-fit: cover; border-radius: 3px; background: #eef6fd; display: grid; place-items: center; color: #6d87a3; font-weight: 800; }
    .photo-card h4 { margin: 8px 0 4px; color: #0a2f5f; }
    .photo-card p { margin: 2px 0; font-size: 10px; color: #102a43; }
    .file-name { overflow-wrap: anywhere; color: #42627f !important; }
    .empty-evidence { padding: 12px; border: 1px dashed #aac3dc; color: #42627f; }
    .incident-divider { display: none; }
    footer { margin-top: auto; display: flex; justify-content: space-between; align-items: end; padding-top: 16px; color: #0a2f5f; font-size: 11px; font-weight: 700; }
    .footer-brand { display: flex; align-items: center; gap: 12px; }
    .footer-brand img { width: 96px; height: auto; object-fit: contain; }
    .wave { height: 28px; margin-top: 10px; background: linear-gradient(160deg, transparent 0 45%, rgba(80, 169, 229, 0.22) 46% 100%); }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style></head><body><main class="page"><header><div class="brand"><img class="brand-logo" src="${MX_PATROL_REPORT_LOGO_SRC}" alt="TTECH MX Patrol" /></div><div class="meta"><b>Company:</b><span>${escapeHtml(input.companyName)}</span><b>Site:</b><span>${escapeHtml(input.siteName)}</span><b>Report Type:</b><span>${escapeHtml(content.title)}</span><b>Report Period:</b><span>${escapeHtml(input.periodLabel)}</span><b>Generated On:</b><span>${escapeHtml(formatReportDateTime(generatedAt))}</span></div></header><section class="title"><div><h2>${escapeHtml(content.title)}</h2><p>${escapeHtml(content.subtitle)}</p></div><div>People | Sites | Security | Safer Tomorrow</div></section>${content.html}<div class="totals">${escapeHtml(content.totals)}</div>${evidenceHtml}<div class="wave"></div><footer><span class="footer-brand"><img src="${MX_PATROL_REPORT_LOGO_SRC}" alt="TTECH MX Patrol" /><span>${escapeHtml(MX_PATROL_REPORT_TAGLINE)}</span></span><span>Page 1 of 1</span></footer></main></body></html>`;
}

function pdfEscape(value: unknown): string {
  return String(value ?? "").split("").map((char) => {
    const code = char.charCodeAt(0);
    if (char === "\\" || char === "(" || char === ")") return "\\" + char;
    if (code === 10 || code === 13) return " ";
    return char;
  }).join("");
}

type PdfTableModel = { title: string; subtitle: string; totals: string; orientation: "portrait" | "landscape"; firstHeader: string; headers: string[]; rows: string[][]; evidence?: string[][]; compactWide?: boolean };
type PdfReportLogo = { width: number; height: number; hex: string };

function reportFilename(input: MxPdfReportInput): string {
  const type = input.type.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("-");
  const period = input.periodLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Report";
  return "MX-Patrol-" + type + "-Report-" + period + ".pdf";
}

function reportTableModel(input: MxPdfReportInput): PdfTableModel {
  const content = contentFor(input);
  const scans = input.scans ?? [];
  const patrols = input.patrols ?? [];
  const alerts = input.alerts ?? [];
  const incidents = input.incidents ?? [];
  const datalogs = input.datalogs ?? [];
  if (input.type === "checkpoint_scan") {
    const matrix = buildCheckpointScanMatrix(scans, input.checkpoints ?? [], { oneDay: isOneDayReportPeriod(input.periodLabel) });
    return { title: content.title, subtitle: content.subtitle, totals: content.totals, orientation: "landscape", firstHeader: "Checkpoint", headers: matrix.columns, rows: matrix.rows.map((row) => [row.label, ...row.cells.map((cell) => cell.length ? cell.join("\n") : "-")]), compactWide: matrix.columns.length <= 18 && matrix.rows.length <= 10 };
  }
  if (input.type === "device_scan") {
    const matrix = buildDeviceScanMatrix(scans, input.checkpoints ?? [], { oneDay: isOneDayReportPeriod(input.periodLabel) });
    return { title: content.title, subtitle: content.subtitle, totals: content.totals, orientation: "landscape", firstHeader: "Device", headers: matrix.columns, rows: matrix.rows.map((row) => [row.label, ...row.cells.map((cell) => cell.length ? cell.join("\n") : "-")]) };
  }
  if (input.type === "patrol") {
    return { title: content.title, subtitle: content.subtitle, totals: content.totals, orientation: "landscape", firstHeader: "Patrol", headers: ["Site", "Date", "Scheduled", "Actual Start", "Completion", "Status", "Completed", "Missed", "Late"], rows: patrols.map((row) => [row.patrol_name ?? row.patrol_routes?.name ?? row.patrol_templates?.name ?? "Patrol", siteName(row), reportDate(row.scheduled_start), reportTime(row.scheduled_start), reportTime(row.actual_start), reportTime(row.actual_end ?? row.finalized_at ?? row.completed_at), statusText(row.status), String(row.checkpoint_completed ?? row.completed_checkpoints ?? 0), String(row.missed_checkpoint_count ?? Math.max((row.checkpoint_total ?? row.expected_checkpoints ?? 0) - (row.checkpoint_completed ?? row.completed_checkpoints ?? 0), 0)), lateDuration(row)]) };
  }
  if (input.type === "sos") {
    const sos = alerts.filter((alert) => String(alert.type ?? "").includes("panic") || String(alert.title ?? "").toLowerCase().includes("sos"));
    return { title: content.title, subtitle: content.subtitle, totals: content.totals, orientation: "portrait", firstHeader: "Date & Time", headers: ["Device", "Site", "Status", "Response", "Resolved"], rows: sos.map((row) => [formatReportDateTime(row.created_at), deviceName(row), siteName(row), row.is_read ? "Resolved" : "Active", reportTime(row.acknowledged_at ?? row.updated_at), reportTime(row.resolved_at)]) };
  }
  if (input.type === "incident") {
    const evidenceRows: string[][] = [];
    incidents.forEach((row) => {
      const evidence = incidentEvidenceFor(input, row);
      evidence.photos.forEach((photo, index) => evidenceRows.push([incidentId(row), "Photo " + (index + 1), photo.filename ?? filenameFromPath(photo.storage_path), formatReportDateTime(photo.captured_at ?? photo.created_at ?? row.created_at)]));
      evidence.audio.forEach((audio, index) => evidenceRows.push([incidentId(row), "Audio " + (index + 1), audio.filename ?? filenameFromPath(audio.storage_path), durationLabel(audio.duration_seconds)]));
    });
    return { title: content.title, subtitle: content.subtitle, totals: content.totals, orientation: "landscape", firstHeader: "Incident ID", headers: ["Date & Time", "Site", "Device", "Type", "Priority", "Description", "Status", "Photos", "Audio"], rows: incidents.map((row) => { const counts = evidenceCounts(input, row); return [incidentId(row), formatReportDateTime(row.created_at), siteName(row), deviceName(row), row.incident_type ?? row.type ?? "Incident", row.severity ?? row.priority ?? "Normal", row.title ?? row.description ?? row.message ?? "-", row.resolved ? "Resolved" : "Open", String(counts.photos), String(counts.audio)]; }), evidence: evidenceRows };
  }
  return { title: content.title, subtitle: content.subtitle, totals: content.totals, orientation: "portrait", firstHeader: "Date & Time", headers: ["Site", "Checkpoint", "Device", "Datalog Text"], rows: datalogs.map((row) => [formatReportDateTime(row.submitted_at ?? row.created_at), siteName(row), row.checkpoints?.name ?? row.checkpoint_name ?? "Checkpoint", deviceName(row), row.datalog_value ?? row.responses_json?.datalog_value ?? row.responses_json?.value ?? "-"]) };
}

function wrapPdfText(value: unknown, maxChars: number): string[] {
  const source = String(value ?? "-").replace(/\r/g, "").split("\n");
  const lines: string[] = [];
  source.forEach((part) => {
    const words = part.split(/\s+/).filter(Boolean);
    let line = "";
    words.forEach((word) => {
      if (!line) line = word;
      else if ((line + " " + word).length <= maxChars) line += " " + word;
      else { lines.push(line); line = word; }
      while (line.length > maxChars) { lines.push(line.slice(0, maxChars)); line = line.slice(maxChars); }
    });
    lines.push(line || "-");
  });
  return lines.slice(0, 8);
}

function pdfByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") + ">";
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadReportLogoForPdf(): Promise<PdfReportLogo | null> {
  if (typeof window === "undefined" || typeof Image === "undefined" || typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return resolve(null);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const bytes = dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92));
      resolve({ width: canvas.width, height: canvas.height, hex: bytesToHex(bytes) });
    };
    image.onerror = () => resolve(null);
    image.src = MX_PATROL_REPORT_LOGO_SRC;
  });
}

function pdfBlobFromString(pdf: string): Blob {
  if (!pdf.startsWith("%PDF-")) throw new Error("PDF generation failed: invalid PDF header.");
  return new Blob([new TextEncoder().encode(pdf)], { type: "application/pdf" });
}

function ensurePdfFilename(filename: string): string {
  return filename.toLowerCase().endsWith(".pdf") ? filename : filename.replace(/\.[^.]+$/, "") + ".pdf";
}

function pdfTextAt(x: number, y: number, text: string, size = 8, bold = false): string {
  return "BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " + x.toFixed(1) + " " + y.toFixed(1) + " Td (" + pdfEscape(text) + ") Tj ET\n";
}

function pdfRect(x: number, y: number, w: number, h: number, fill = false): string {
  return x.toFixed(1) + " " + y.toFixed(1) + " " + w.toFixed(1) + " " + h.toFixed(1) + " re " + (fill ? "f" : "S") + "\n";
}

function tableChunks(model: PdfTableModel, maxDataColumns: number) {
  const chunks: Array<{ headers: string[]; rows: string[][] }> = [];
  const dataHeaders = model.headers.length ? model.headers : [];
  if (model.compactWide) return [{ headers: [model.firstHeader, ...dataHeaders], rows: model.rows }];
  if (dataHeaders.length <= maxDataColumns) return [{ headers: [model.firstHeader, ...dataHeaders], rows: model.rows }];
  for (let i = 0; i < dataHeaders.length; i += maxDataColumns) {
    const headers = [model.firstHeader, ...dataHeaders.slice(i, i + maxDataColumns)];
    const rows = model.rows.map((row) => [row[0], ...row.slice(i + 1, i + 1 + maxDataColumns)]);
    chunks.push({ headers, rows });
  }
  return chunks;
}

function buildTablePages(input: MxPdfReportInput, logo?: PdfReportLogo | null): { width: number; height: number; streams: string[] } {
  const model = reportTableModel(input);
  const landscape = model.orientation === "landscape";
  const width = landscape ? 842 : 595;
  const height = landscape ? 595 : 842;
  const margin = model.compactWide ? 22 : 34;
  const top = height - margin;
  const bottom = margin + 26;
  const usableWidth = width - margin * 2;
  const maxDataColumns = model.compactWide ? Math.max(1, model.headers.length) : landscape ? 6 : 4;
  const chunks = tableChunks(model, maxDataColumns);
  const streams: string[] = [];
  const drawLogo = (x: number, y: number, maxWidth: number, maxHeight: number) => {
    if (!logo) return pdfTextAt(x, y + maxHeight - 16, "TTECH", 18, true) + pdfTextAt(x + 38, y + maxHeight - 31, "MX PATROL", 8, true);
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
    const imageWidth = logo.width * scale;
    const imageHeight = logo.height * scale;
    return "q\n" + imageWidth.toFixed(1) + " 0 0 " + imageHeight.toFixed(1) + " " + x.toFixed(1) + " " + y.toFixed(1) + " cm\n/ImLogo Do\nQ\n";
  };
  const addPage = (chunkTitle: string) => {
    let stream = "0.02 w\n";
    stream += drawLogo(margin, top - 41, 132, 42);
    stream += pdfTextAt(margin, top - 56, model.title + (chunkTitle ? " - " + chunkTitle : ""), 14, true);
    stream += pdfTextAt(margin, top - 71, model.subtitle, 9);
    stream += pdfTextAt(width - 255, top, "Company: " + input.companyName, 9, true);
    stream += pdfTextAt(width - 255, top - 13, "Site: " + input.siteName, 9);
    stream += pdfTextAt(width - 255, top - 26, "Report Period: " + input.periodLabel, 9);
    stream += pdfTextAt(width - 255, top - 39, "Generated: " + formatReportDateTime(input.generatedAt ?? new Date()), 9);
    stream += "0.75 0.82 0.90 RG " + margin + " " + (top - 82) + " " + usableWidth + " 0 m S\n0 0 0 RG\n";
    return { stream, y: top - 104 };
  };
  chunks.forEach((chunk, chunkIndex) => {
    const label = chunks.length > 1 ? "Columns " + (chunkIndex + 1) + " of " + chunks.length : "";
    let page = addPage(label);
    const colCount = chunk.headers.length;
    const firstWidth = model.compactWide ? Math.min(170, Math.max(140, usableWidth * 0.22)) : Math.min(130, usableWidth * 0.25);
    const otherWidth = (usableWidth - firstWidth) / Math.max(1, colCount - 1);
    const widths = chunk.headers.map((_, index) => index === 0 ? firstWidth : otherWidth);
    const headerHeight = model.compactWide ? 20 : 24;
    const drawHeader = () => {
      let x = margin;
      page.stream += "0.04 0.22 0.42 rg\n";
      chunk.headers.forEach((header, index) => { page.stream += pdfRect(x, page.y - headerHeight, widths[index], headerHeight, true); x += widths[index]; });
      page.stream += "1 1 1 rg\n";
      x = margin;
      chunk.headers.forEach((header, index) => { page.stream += pdfTextAt(x + (model.compactWide ? 2 : 4), page.y - (model.compactWide ? 13 : 15), header, model.compactWide ? 6.6 : 7.5, true); x += widths[index]; });
      page.stream += "0 0 0 rg 0.65 0.72 0.80 RG\n";
      page.y -= headerHeight;
    };
    drawHeader();
    chunk.rows.forEach((row) => {
      const wrapped = row.map((cell, index) => wrapPdfText(cell, index === 0 ? Math.max(16, Math.floor(widths[index] / 4.8)) : Math.max(5, Math.floor(widths[index] / 4.2))));
      const rowHeight = model.compactWide ? Math.max(19, Math.max(...wrapped.map((lines) => lines.length)) * 7.6 + 7) : Math.max(22, Math.max(...wrapped.map((lines) => lines.length)) * 9 + 10);
      if (page.y - rowHeight < bottom) {
        streams.push(page.stream);
        page = addPage(label);
        drawHeader();
      }
      let x = margin;
      wrapped.forEach((lines, colIndex) => {
        page.stream += pdfRect(x, page.y - rowHeight, widths[colIndex], rowHeight);
        lines.forEach((line, lineIndex) => { page.stream += pdfTextAt(x + (model.compactWide ? 2 : 4), page.y - (model.compactWide ? 10 : 11) - lineIndex * (model.compactWide ? 7.6 : 9), line, model.compactWide ? 6.5 : 7.2, colIndex === 0); });
        x += widths[colIndex];
      });
      page.y -= rowHeight;
    });
    page.stream += pdfTextAt(margin, Math.max(bottom - 4, page.y - 16), model.totals, 9, true);
    streams.push(page.stream);
  });
  if (model.evidence?.length) {
    let page = addPage("Evidence");
    const evidence = { headers: ["Incident", "Evidence", "File", "Time / Duration"], rows: model.evidence };
    const widths = [100, 80, usableWidth - 300, 120];
    const headerHeight = 24;
    let x = margin;
    page.stream += "0.04 0.22 0.42 rg\n";
    evidence.headers.forEach((header, index) => { page.stream += pdfRect(x, page.y - headerHeight, widths[index], headerHeight, true); x += widths[index]; });
    page.stream += "1 1 1 rg\n";
    x = margin;
    evidence.headers.forEach((header, index) => { page.stream += pdfTextAt(x + 4, page.y - 15, header, 7.5, true); x += widths[index]; });
    page.stream += "0 0 0 rg 0.65 0.72 0.80 RG\n";
    page.y -= headerHeight;
    evidence.rows.forEach((row) => {
      const wrapped = row.map((cell, index) => wrapPdfText(cell, Math.max(8, Math.floor(widths[index] / 4.2))));
      const rowHeight = Math.max(22, Math.max(...wrapped.map((lines) => lines.length)) * 9 + 10);
      if (page.y - rowHeight < bottom) { streams.push(page.stream); page = addPage("Evidence"); }
      let x = margin;
      wrapped.forEach((lines, colIndex) => { page.stream += pdfRect(x, page.y - rowHeight, widths[colIndex], rowHeight); lines.forEach((line, lineIndex) => { page.stream += pdfTextAt(x + 4, page.y - 11 - lineIndex * 9, line, 7.2, colIndex === 0); }); x += widths[colIndex]; });
      page.y -= rowHeight;
    });
    streams.push(page.stream);
  }
  return { width, height, streams: streams.map((stream, index) => stream + drawLogo(margin, 12, 82, 18) + pdfTextAt(margin + 96, 18, MX_PATROL_REPORT_TAGLINE, 7) + pdfTextAt(width - 100, 18, "Page " + (index + 1) + " of " + streams.length, 8)) };
}

export function buildMxPdfReportBlob(input: MxPdfReportInput, logo?: PdfReportLogo | null): Blob {
  const pages = buildTablePages(input, logo);
  const objects: string[] = [];
  const pageObjectIds = pages.streams.map((_, index) => 3 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [" + pageObjectIds.map((id) => id + " 0 R").join(" ") + "] /Count " + pages.streams.length + " >>");
  pages.streams.forEach((stream, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const font1Id = pageObjectIds.length * 2 + 3;
    const font2Id = pageObjectIds.length * 2 + 4;
    const imageId = logo ? pageObjectIds.length * 2 + 5 : null;
    const xObject = imageId ? " /XObject << /ImLogo " + imageId + " 0 R >>" : "";
    objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pages.width + " " + pages.height + "] /Resources << /Font << /F1 " + font1Id + " 0 R /F2 " + font2Id + " 0 R >>" + xObject + " >> /Contents " + contentId + " 0 R >>");
    objects.push("<< /Length " + pdfByteLength(stream) + " >>\nstream\n" + stream + "\nendstream");
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  if (logo) objects.push("<< /Type /XObject /Subtype /Image /Width " + logo.width + " /Height " + logo.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length " + logo.hex.length + " >>\nstream\n" + logo.hex + "\nendstream");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n"; });
  const xref = pdf.length;
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => { pdf += String(offset).padStart(10, "0") + " 00000 n \n"; });
  pdf += "trailer << /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return pdfBlobFromString(pdf);
}

export async function downloadMxPdfReport(input: MxPdfReportInput, filename = reportFilename(input)): Promise<void> {
  const pdfBlob = buildMxPdfReportBlob(input, await loadReportLogoForPdf());
  if (pdfBlob.type !== "application/pdf") throw new Error("PDF generation failed: expected application/pdf output.");
  const url = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = ensurePdfFilename(filename);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildMxPdfReportResult(input: MxPdfReportInput) {
  return { input, html: buildMxPdfReportHtml(input), filename: reportFilename(input) };
}

export function reportTypeFromAction(action: string): MxPdfReportType | null {
  if (action === "report:checkpoint_scan" || action.includes("checkpoint_scan") || action.includes("checkpoint_scans") || action.includes("checkpoint_activity")) return "checkpoint_scan";
  if (action === "report:device_scan" || action.includes("device_scan") || action.includes("devices")) return "device_scan";
  if (action === "report:patrol" || action.includes("patrol")) return "patrol";
  if (action === "report:sos" || action.includes("sos")) return "sos";
  if (action === "report:incident" || action.includes("incident")) return "incident";
  if (action === "report:datalog" || action.includes("data_log") || action.includes("datalog")) return "datalog";
  return null;
}
