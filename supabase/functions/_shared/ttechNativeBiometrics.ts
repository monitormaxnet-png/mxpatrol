export type TtechGrayImage = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray | number[];
};

export type TtechFaceCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  symmetry: number;
  contrast: number;
  sharpness: number;
  quality: 'usable' | 'poor';
  reason?: string;
};

export type TtechFaceTemplate = {
  id: string;
  guardId: string;
  companyId: string;
  siteIds?: string[] | null;
  status: 'active' | 'revoked' | 'pending';
  version: number;
  vector: number[];
  createdAt?: string;
};

export type TtechMatchResult = {
  status: 'matched' | 'unmatched' | 'ambiguous' | 'no_templates';
  guardId: string | null;
  templateId: string | null;
  similarity: number | null;
  margin: number | null;
  candidates: Array<{ templateId: string; guardId: string; similarity: number }>;
  reason: string;
};

export type TtechLivenessResult = {
  status: 'inconclusive' | 'likely_live' | 'spoof_risk';
  reason: string;
  indicators: Record<string, number | string | boolean>;
};

export const TTECH_NATIVE_ENGINE_VERSION = 'ttech-native-research-0.1';

export const TTECH_RESEARCH_MATCH_CALIBRATION = {
  minSimilarity: 0.92,
  minMargin: 0.06,
};

export function validateGrayImage(image: TtechGrayImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 16 || image.height < 16) {
    throw new Error('Image must be at least 16x16 pixels');
  }
  if (image.pixels.length !== image.width * image.height) {
    throw new Error('Pixel buffer length does not match width*height');
  }
}

export function preprocessFaceImage(image: TtechGrayImage): TtechGrayImage {
  validateGrayImage(image);
  const values = Array.from(image.pixels, clampByte);
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.98)] ?? 255;
  const span = Math.max(1, high - low);
  const out = new Uint8ClampedArray(values.length);
  for (let i = 0; i < values.length; i++) out[i] = clampByte(((values[i] - low) / span) * 255);
  return { width: image.width, height: image.height, pixels: out };
}

export function detectTtechFaces(image: TtechGrayImage): TtechFaceCandidate[] {
  const normalized = preprocessFaceImage(image);
  const { width, height } = normalized;
  const pixels = Array.from(normalized.pixels, clampByte);
  const stats = meanStd(pixels);
  const threshold = Math.min(245, Math.max(50, stats.mean + stats.std * 0.28));
  const visited = new Uint8Array(pixels.length);
  const candidates: TtechFaceCandidate[] = [];

  for (let index = 0; index < pixels.length; index++) {
    if (visited[index] || pixels[index] < threshold) continue;
    const component = floodBrightComponent(index, width, height, pixels, visited, threshold);
    if (component.count < Math.max(24, width * height * 0.01)) continue;
    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    const aspect = boxWidth / Math.max(1, boxHeight);
    const fill = component.count / Math.max(1, boxWidth * boxHeight);
    if (aspect < 0.48 || aspect > 1.35 || fill < 0.28 || fill > 0.92) continue;

    const symmetry = verticalSymmetry(normalized, component.minX, component.minY, boxWidth, boxHeight);
    const contrast = localContrast(normalized, component.minX, component.minY, boxWidth, boxHeight);
    const sharpness = laplacianVariance(normalized, component.minX, component.minY, boxWidth, boxHeight);
    const ovalScore = 1 - Math.min(1, Math.abs(aspect - 0.78));
    const score = clamp01(0.34 * symmetry + 0.28 * contrast + 0.22 * ovalScore + 0.16 * clamp01(sharpness / 900));
    const quality = score >= 0.48 && contrast >= 0.16 && symmetry >= 0.42 ? 'usable' : 'poor';
    candidates.push({
      x: component.minX,
      y: component.minY,
      width: boxWidth,
      height: boxHeight,
      score: round(score),
      symmetry: round(symmetry),
      contrast: round(contrast),
      sharpness: round(sharpness),
      quality,
      reason: quality === 'usable' ? undefined : 'Low symmetry, contrast, or sharpness for the research detector',
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function assessFaceQuality(image: TtechGrayImage, candidate: TtechFaceCandidate | null): { status: 'passed' | 'failed'; reason: string; metrics: Record<string, number | string> } {
  if (!candidate) return { status: 'failed', reason: 'No face candidate detected', metrics: {} };
  const faceArea = (candidate.width * candidate.height) / (image.width * image.height);
  const metrics = { score: candidate.score, symmetry: candidate.symmetry, contrast: candidate.contrast, sharpness: candidate.sharpness, faceArea: round(faceArea) };
  if (candidate.quality !== 'usable') return { status: 'failed', reason: candidate.reason ?? 'Face quality is below threshold', metrics };
  if (faceArea < 0.06) return { status: 'failed', reason: 'Face is too small in frame', metrics };
  if (faceArea > 0.75) return { status: 'failed', reason: 'Face is too close to camera', metrics };
  return { status: 'passed', reason: 'Research quality checks passed', metrics };
}

export function encodeTtechFace(image: TtechGrayImage, candidate: TtechFaceCandidate): number[] {
  validateGrayImage(image);
  const normalized = preprocessFaceImage(image);
  const crop = resizeCrop(normalized, candidate.x, candidate.y, candidate.width, candidate.height, 16, 16);
  const vector: number[] = [];

  for (let cellY = 0; cellY < 8; cellY++) {
    for (let cellX = 0; cellX < 8; cellX++) {
      let sum = 0;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) sum += crop[(cellY * 2 + y) * 16 + (cellX * 2 + x)];
      vector.push(sum / (4 * 255));
    }
  }

  for (let y = 1; y < 15; y += 2) {
    for (let x = 1; x < 15; x += 2) {
      const gx = crop[y * 16 + x + 1] - crop[y * 16 + x - 1];
      const gy = crop[(y + 1) * 16 + x] - crop[(y - 1) * 16 + x];
      vector.push(gx / 255, gy / 255);
    }
  }

  const centered = centerVector(vector);
  return l2Normalize(centered).map(round);
}

export function compareTtechTemplates(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) throw new Error('Template vectors must have the same non-zero length');
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return round(dot / Math.max(1e-9, Math.sqrt(aa) * Math.sqrt(bb)));
}

export function identifyTtechFace(input: {
  vector: number[];
  templates: TtechFaceTemplate[];
  companyId: string;
  siteId?: string | null;
  minSimilarity?: number;
  minMargin?: number;
}): TtechMatchResult {
  const active = input.templates.filter((template) => {
    if (template.status !== 'active') return false;
    if (template.companyId !== input.companyId) return false;
    if (input.siteId && template.siteIds?.length && !template.siteIds.includes(input.siteId)) return false;
    return true;
  });
  if (!active.length) return { status: 'no_templates', guardId: null, templateId: null, similarity: null, margin: null, candidates: [], reason: 'No active enrolled templates for this company/site scope' };

  const candidates = active
    .map((template) => ({ templateId: template.id, guardId: template.guardId, similarity: compareTtechTemplates(input.vector, template.vector) }))
    .sort((a, b) => b.similarity - a.similarity);
  const top = candidates[0];
  const second = candidates[1];
  const margin = top && second ? round(top.similarity - second.similarity) : top ? 1 : null;
  const minSimilarity = input.minSimilarity ?? TTECH_RESEARCH_MATCH_CALIBRATION.minSimilarity;
  const minMargin = input.minMargin ?? TTECH_RESEARCH_MATCH_CALIBRATION.minMargin;

  if (!top || top.similarity < minSimilarity) return { status: 'unmatched', guardId: null, templateId: null, similarity: top?.similarity ?? null, margin, candidates: candidates.slice(0, 3), reason: 'Top candidate is below the research similarity threshold' };
  if (margin != null && margin < minMargin) return { status: 'ambiguous', guardId: null, templateId: null, similarity: top.similarity, margin, candidates: candidates.slice(0, 3), reason: 'Top candidates are too close together for a unique identity decision' };
  return { status: 'matched', guardId: top.guardId, templateId: top.templateId, similarity: top.similarity, margin, candidates: candidates.slice(0, 3), reason: 'Research matcher found a unique top candidate' };
}

export function analyzeTtechStillLiveness(image: TtechGrayImage, candidate: TtechFaceCandidate | null): TtechLivenessResult {
  if (!candidate) return { status: 'inconclusive', reason: 'No face candidate available for liveness analysis', indicators: {} };
  const glare = highlightRatio(image, candidate);
  const texture = candidate.sharpness;
  const risk = glare > 0.08 || texture < 8;
  return {
    status: risk ? 'spoof_risk' : 'inconclusive',
    reason: risk
      ? 'Still-image liveness research detected presentation-risk indicators; supervisor review required'
      : 'Single still image cannot prove liveness; challenge/sequence capture is required before automatic approval',
    indicators: { glare: round(glare), sharpness: round(texture), singleStillLimitation: true },
  };
}

function floodBrightComponent(start: number, width: number, height: number, pixels: number[], visited: Uint8Array, threshold: number) {
  const stack = [start];
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  visited[start] = 1;
  while (stack.length) {
    const index = stack.pop()!;
    const x = index % width;
    const y = Math.floor(index / width);
    count++;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!visited[ni] && pixels[ni] >= threshold) { visited[ni] = 1; stack.push(ni); }
    }
  }
  return { count, minX, minY, maxX, maxY };
}

function resizeCrop(image: TtechGrayImage, x: number, y: number, width: number, height: number, outW: number, outH: number): number[] {
  const out: number[] = [];
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const sx = Math.min(image.width - 1, Math.max(0, Math.round(x + (ox + 0.5) * width / outW)));
      const sy = Math.min(image.height - 1, Math.max(0, Math.round(y + (oy + 0.5) * height / outH)));
      out.push(clampByte(image.pixels[sy * image.width + sx]));
    }
  }
  return out;
}

function verticalSymmetry(image: TtechGrayImage, x: number, y: number, width: number, height: number): number {
  let diff = 0;
  let total = 0;
  const half = Math.floor(width / 2);
  for (let yy = y; yy < y + height; yy++) {
    for (let dx = 0; dx < half; dx++) {
      const left = clampByte(image.pixels[yy * image.width + x + dx]);
      const right = clampByte(image.pixels[yy * image.width + x + width - 1 - dx]);
      diff += Math.abs(left - right);
      total += 255;
    }
  }
  return clamp01(1 - diff / Math.max(1, total));
}

function localContrast(image: TtechGrayImage, x: number, y: number, width: number, height: number): number {
  const inside: number[] = [];
  const outside: number[] = [];
  for (let yy = Math.max(0, y - 4); yy < Math.min(image.height, y + height + 4); yy++) {
    for (let xx = Math.max(0, x - 4); xx < Math.min(image.width, x + width + 4); xx++) {
      const value = clampByte(image.pixels[yy * image.width + xx]);
      if (xx >= x && xx < x + width && yy >= y && yy < y + height) inside.push(value); else outside.push(value);
    }
  }
  return clamp01(Math.abs(mean(inside) - mean(outside)) / 255);
}

function laplacianVariance(image: TtechGrayImage, x: number, y: number, width: number, height: number): number {
  const values: number[] = [];
  for (let yy = Math.max(1, y); yy < Math.min(image.height - 1, y + height); yy++) {
    for (let xx = Math.max(1, x); xx < Math.min(image.width - 1, x + width); xx++) {
      const center = clampByte(image.pixels[yy * image.width + xx]) * 4;
      const lap = center - clampByte(image.pixels[yy * image.width + xx - 1]) - clampByte(image.pixels[yy * image.width + xx + 1]) - clampByte(image.pixels[(yy - 1) * image.width + xx]) - clampByte(image.pixels[(yy + 1) * image.width + xx]);
      values.push(lap);
    }
  }
  const stats = meanStd(values);
  return stats.std * stats.std;
}

function highlightRatio(image: TtechGrayImage, candidate: TtechFaceCandidate): number {
  let bright = 0;
  let total = 0;
  for (let y = candidate.y; y < candidate.y + candidate.height; y++) for (let x = candidate.x; x < candidate.x + candidate.width; x++) {
    total++;
    if (clampByte(image.pixels[y * image.width + x]) > 246) bright++;
  }
  return bright / Math.max(1, total);
}

function centerVector(values: number[]): number[] {
  const m = mean(values);
  return values.map((value) => value - m);
}

function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function meanStd(values: number[]) {
  const m = mean(values);
  const variance = values.length ? values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length : 0;
  return { mean: m, std: Math.sqrt(variance) };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
