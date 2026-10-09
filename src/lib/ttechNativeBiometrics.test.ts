import { describe, expect, it } from 'vitest';
import {
  analyzeTtechStillLiveness,
  assessFaceQuality,
  compareTtechTemplates,
  detectTtechFaces,
  encodeTtechFace,
  identifyTtechFace,
  TtechGrayImage,
  TtechFaceTemplate,
} from '../../supabase/functions/_shared/ttechNativeBiometrics';

function syntheticFace(options: { eyeOffset?: number; mouthY?: number; brightness?: number; noise?: number; xShift?: number } = {}): TtechGrayImage {
  const width = 96;
  const height = 112;
  const pixels = new Uint8ClampedArray(width * height).fill(24);
  const cx = 48 + (options.xShift ?? 0);
  const cy = 54;
  const rx = 24;
  const ry = 34;
  const face = options.brightness ?? 188;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oval = ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2);
      if (oval <= 1) pixels[y * width + x] = face + (((x + y) % 5) - 2) * (options.noise ?? 2);
    }
  }
  const eyeOffset = options.eyeOffset ?? 9;
  drawDisk(pixels, width, cx - eyeOffset, cy - 8, 3, 35);
  drawDisk(pixels, width, cx + eyeOffset, cy - 8, 3, 35);
  const mouthY = cy + (options.mouthY ?? 14);
  for (let x = cx - 10; x <= cx + 10; x++) for (let y = mouthY - 1; y <= mouthY + 1; y++) pixels[y * width + x] = 42;
  for (let y = cy - 2; y <= cy + 10; y++) pixels[y * width + cx] = 130;
  return { width, height, pixels };
}

function drawDisk(pixels: Uint8ClampedArray, width: number, cx: number, cy: number, r: number, value: number) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) pixels[y * width + x] = value;
  }
}

function template(id: string, guardId: string, companyId: string, vector: number[], siteIds = ['site-a']): TtechFaceTemplate {
  return { id, guardId, companyId, siteIds, status: 'active', version: 1, vector };
}

describe('TTECH native biometric research engine', () => {
  it('detects a face-like candidate and reports quality metrics', () => {
    const image = syntheticFace();
    const [candidate] = detectTtechFaces(image);
    expect(candidate).toBeTruthy();
    expect(candidate.quality).toBe('usable');
    expect(candidate.score).toBeGreaterThan(0.45);
    const quality = assessFaceQuality(image, candidate);
    expect(quality.status).toBe('passed');
  });

  it('creates stable original face templates for the same synthetic identity', () => {
    const imageA = syntheticFace({ brightness: 186, noise: 2 });
    const imageB = syntheticFace({ brightness: 200, noise: 3, xShift: 1 });
    const vectorA = encodeTtechFace(imageA, detectTtechFaces(imageA)[0]);
    const vectorB = encodeTtechFace(imageB, detectTtechFaces(imageB)[0]);
    expect(vectorA.length).toBe(vectorB.length);
    expect(compareTtechTemplates(vectorA, vectorB)).toBeGreaterThan(0.92);
  });

  it('performs scoped 1:N matching and rejects cross-company templates', () => {
    const probe = syntheticFace({ eyeOffset: 9, mouthY: 14 });
    const other = syntheticFace({ eyeOffset: 14, mouthY: 20 });
    const probeVector = encodeTtechFace(probe, detectTtechFaces(probe)[0]);
    const templates = [
      template('template-a', 'guard-a', 'company-a', probeVector),
      template('template-b', 'guard-b', 'company-a', encodeTtechFace(other, detectTtechFaces(other)[0])),
      template('template-c', 'guard-c', 'company-b', probeVector),
    ];
    const result = identifyTtechFace({ vector: probeVector, templates, companyId: 'company-a', siteId: 'site-a' });
    expect(result.status).toBe('matched');
    expect(result.guardId).toBe('guard-a');
    expect(result.candidates.some((candidate) => candidate.guardId === 'guard-c')).toBe(false);
  });

  it('flags ambiguous candidate separation instead of forcing identity', () => {
    const probe = syntheticFace({ eyeOffset: 10 });
    const vector = encodeTtechFace(probe, detectTtechFaces(probe)[0]);
    const result = identifyTtechFace({
      vector,
      companyId: 'company-a',
      siteId: 'site-a',
      minSimilarity: 0.7,
      minMargin: 0.2,
      templates: [
        template('template-a', 'guard-a', 'company-a', vector),
        template('template-b', 'guard-b', 'company-a', [...vector]),
      ],
    });
    expect(result.status).toBe('ambiguous');
    expect(result.guardId).toBeNull();
  });

  it('does not claim still-photo liveness is proven', () => {
    const image = syntheticFace();
    const candidate = detectTtechFaces(image)[0];
    const liveness = analyzeTtechStillLiveness(image, candidate);
    expect(['inconclusive', 'spoof_risk']).toContain(liveness.status);
    expect(String(liveness.reason).toLowerCase()).toContain('still');
  });
});
