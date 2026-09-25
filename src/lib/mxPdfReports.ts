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

export function buildCheckpointScanMatrix(scans: any[], checkpoints: any[] = []) {
  const checkpointNames = new Set<string>();
  checkpoints.forEach((checkpoint) => checkpointNames.add(String(checkpoint.name ?? "Checkpoint")));
  scans.forEach((scan) => checkpointNames.add(checkpointName(scan)));
  const columns = Array.from(new Set(scans.map((scan) => timeBucket(scan.scanned_at)))).sort();
  const rows = Array.from(checkpointNames).sort().map((checkpoint) => {
    const cells = columns.map((column) => scans
      .filter((scan) => checkpointName(scan) === checkpoint && timeBucket(scan.scanned_at) === column)
      .map((scan) => formatReportDateTime(scan.scanned_at)));
    return { label: checkpoint, cells };
  });
  return { columns, rows };
}

export function buildDeviceScanMatrix(scans: any[]) {
  const devices = Array.from(new Set(scans.map(deviceName))).sort();
  const columns = Array.from(new Set(scans.map(checkpointName))).sort();
  const rows = devices.map((device) => {
    const cells = columns.map((checkpoint) => scans
      .filter((scan) => deviceName(scan) === device && checkpointName(scan) === checkpoint)
      .map((scan) => formatReportDateTime(scan.scanned_at)));
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
    const matrix = buildCheckpointScanMatrix(scans, input.checkpoints ?? []);
    return { title: "Checkpoint Scan Report", subtitle: "Checkpoint scans by time", html: matrixTable("Checkpoint", matrix.columns, matrix.rows), totals: `Total Checkpoints: ${matrix.rows.length}` };
  }
  if (input.type === "device_scan") {
    const matrix = buildDeviceScanMatrix(scans);
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
    body { margin: 0; color: #08254a; font-family: Arial, Helvetica, sans-serif; background: #fff; }
    .page { min-height: 186mm; display: flex; flex-direction: column; }
    header { display: grid; grid-template-columns: 1fr 1.2fr; gap: 24px; align-items: start; border-bottom: 3px solid #0d477d; padding-bottom: 12px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .shield { width: 54px; height: 54px; border-radius: 14px; background: #0a2f5f; color: white; display: grid; place-items: center; font-size: 28px; font-weight: 900; }
    h1 { margin: 0; font-size: 30px; letter-spacing: 0.02em; color: #0a2f5f; }
    .tagline { margin-top: 2px; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; color: #245b91; }
    .meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 11px; }
    .meta b { color: #0a2f5f; }
    .title { margin: 20px 0 12px; display: flex; justify-content: space-between; gap: 20px; }
    .title h2 { margin: 0; color: #0a2f5f; font-size: 24px; }
    .title p { margin: 3px 0 0; font-size: 14px; color: #064989; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
    th { background: #0a376a; color: #fff; padding: 8px 6px; text-align: left; border: 1px solid #7ea4c7; }
    td { padding: 7px 6px; border: 1px solid #c8d8e8; vertical-align: top; color: #102a43; word-break: break-word; }
    tbody tr:nth-child(even) td { background: #f6fbff; }
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
    .wave { height: 28px; margin-top: 10px; background: linear-gradient(160deg, transparent 0 45%, rgba(80, 169, 229, 0.22) 46% 100%); }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style></head><body><main class="page"><header><div class="brand"><div class="shield">MX</div><div><h1>MX PATROL</h1><div class="tagline">SECURITY MONITORING MADE SIMPLE</div></div></div><div class="meta"><b>Company:</b><span>${escapeHtml(input.companyName)}</span><b>Site:</b><span>${escapeHtml(input.siteName)}</span><b>Report Type:</b><span>${escapeHtml(content.title)}</span><b>Report Period:</b><span>${escapeHtml(input.periodLabel)}</span><b>Generated On:</b><span>${escapeHtml(formatReportDateTime(generatedAt))}</span></div></header><section class="title"><div><h2>${escapeHtml(content.title)}</h2><p>${escapeHtml(content.subtitle)}</p></div><div>People | Sites | Security | Safer Tomorrow</div></section>${content.html}<div class="totals">${escapeHtml(content.totals)}</div>${evidenceHtml}<div class="wave"></div><footer><span>Security Today. A Safer Tomorrow.</span><span>Page 1 of 1&nbsp;&nbsp; MX PATROL</span></footer></main></body></html>`;
}

function pdfEscape(value: unknown): string {
  return String(value ?? "").split("").map((char) => {
    const code = char.charCodeAt(0);
    if (char === "\\" || char === "(" || char === ")") return "\\" + char;
    if (code === 10 || code === 13) return " ";
    return char;
  }).join("");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function reportFilename(input: MxPdfReportInput): string {
  const type = input.type.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("-");
  const period = input.periodLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Report";
  return "MX-Patrol-" + type + "-Report-" + period + ".pdf";
}

export function buildMxPdfReportBlob(input: MxPdfReportInput): Blob {
  const content = contentFor(input);
  const lines = [
    "MX PATROL",
    content.title,
    content.subtitle,
    "Company: " + input.companyName,
    "Site: " + input.siteName,
    "Report Period: " + input.periodLabel,
    "Generated On: " + formatReportDateTime(input.generatedAt ?? new Date()),
    "",
    stripHtml(content.html),
    "",
    content.totals,
  ].flatMap((line) => String(line).match(/.{1,105}(\s|$)|\S+/g) ?? [String(line)]).slice(0, 46);

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const text = ["BT", "/F2 22 Tf", "42 552 Td", "(" + pdfEscape(content.title) + ") Tj", "/F1 9 Tf", "0 -22 Td", ...lines.map((line) => "(" + pdfEscape(line) + ") Tj 0 -11 Td"), "ET"].join("\n");
  objects.push("<< /Length " + text.length + " >>\nstream\n" + text + "\nendstream");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
  });
  const xref = pdf.length;
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => { pdf += String(offset).padStart(10, "0") + " 00000 n \n"; });
  pdf += "trailer << /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return new Blob([pdf], { type: "application/pdf" });
}

export function downloadMxPdfReport(input: MxPdfReportInput, filename = reportFilename(input)): void {
  const url = URL.createObjectURL(buildMxPdfReportBlob(input));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
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
