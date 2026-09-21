import { buildMxPdfReportHtml, type MxPdfReportInput, type MxPdfIncidentEvidence } from "./mxPdfReports";

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\\/g, "/");
}

export function evidenceFilename(path?: string | null, fallback = "evidence-file"): string {
  return normalizeZipPath(path || fallback).split("/").filter(Boolean).pop() || fallback;
}

export function buildStoredZip(files: Array<{ path: string; bytes: Uint8Array }>): Blob {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encoder.encode(normalizeZipPath(file.path));
    const checksum = crc32(file.bytes);
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(localHeader, file.bytes);
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length + file.bytes.length;
  });

  const central = concat(centralParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
  return new Blob([concat([...localParts, central, end])], { type: "application/zip" });
}

async function fetchEvidenceBytes(url?: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Evidence download failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function buildIncidentEvidencePackage(input: MxPdfReportInput): Promise<Blob> {
  const root = `Incident-Report-${new Date().toISOString().slice(0, 10)}`;
  const files: Array<{ path: string; bytes: Uint8Array }> = [
    { path: `${root}/Incident-Report.html`, bytes: encoder.encode(buildMxPdfReportHtml(input)) },
  ];
  const evidenceByIncident = input.incidentEvidence ?? {} as Record<string, MxPdfIncidentEvidence>;

  for (const [incidentId, evidence] of Object.entries(evidenceByIncident)) {
    for (let index = 0; index < (evidence.photos ?? []).length; index += 1) {
      const photo = evidence.photos![index];
      const bytes = await fetchEvidenceBytes(photo.signed_url);
      if (bytes) files.push({ path: `${root}/Photos/${incidentId}-Photo-${String(index + 1).padStart(2, "0")}-${evidenceFilename(photo.storage_path)}`, bytes });
    }
    for (let index = 0; index < (evidence.audio ?? []).length; index += 1) {
      const audio = evidence.audio![index];
      const bytes = await fetchEvidenceBytes(audio.signed_url);
      if (bytes) files.push({ path: `${root}/Audio/${incidentId}-Audio-${String(index + 1).padStart(2, "0")}-${evidenceFilename(audio.storage_path)}`, bytes });
    }
  }

  return buildStoredZip(files);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
