import jpeg from "npm:jpeg-js@0.4.4";
import {
  analyzeTtechStillLiveness,
  assessFaceQuality,
  detectTtechFaces,
  encodeTtechFace,
  TTECH_NATIVE_ENGINE_VERSION,
  type TtechFaceCandidate,
  type TtechGrayImage,
  type TtechLivenessResult,
} from "./ttechNativeBiometrics.ts";

export type TtechProcessedFace = {
  image: TtechGrayImage;
  candidates: TtechFaceCandidate[];
  face: TtechFaceCandidate | null;
  quality: ReturnType<typeof assessFaceQuality>;
  liveness: TtechLivenessResult;
  vector: number[] | null;
  engineVersion: string;
};

export function decodeJpegToGrayImage(input: string | Uint8Array, options: { maxBytes?: number; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number } = {}): TtechGrayImage {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const bytes = typeof input === "string" ? decodeBase64(input) : input;
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Only JPEG face photos are supported");
  if (bytes.length > maxBytes) throw new Error("JPEG image is too large for biometric processing");

  const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 });
  const minWidth = options.minWidth ?? 64;
  const minHeight = options.minHeight ?? 64;
  const maxWidth = options.maxWidth ?? 4096;
  const maxHeight = options.maxHeight ?? 4096;
  if (!decoded?.width || !decoded?.height || decoded.width < minWidth || decoded.height < minHeight) throw new Error("JPEG dimensions are too small for face processing");
  if (decoded.width > maxWidth || decoded.height > maxHeight) throw new Error("JPEG dimensions exceed biometric processing limits");

  const gray = new Uint8ClampedArray(decoded.width * decoded.height);
  for (let i = 0, j = 0; i < decoded.data.length; i += 4, j++) {
    const r = decoded.data[i] ?? 0;
    const g = decoded.data[i + 1] ?? 0;
    const b = decoded.data[i + 2] ?? 0;
    gray[j] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { width: decoded.width, height: decoded.height, pixels: gray };
}

export function processTtechFaceJpeg(facePhotoBase64: string): TtechProcessedFace {
  const image = decodeJpegToGrayImage(facePhotoBase64);
  const candidates = detectTtechFaces(image);
  const face = candidates[0] ?? null;
  const quality = assessFaceQuality(image, face);
  const liveness = analyzeTtechStillLiveness(image, face);
  const vector = face && quality.status === "passed" ? encodeTtechFace(image, face) : null;
  return { image, candidates, face, quality, liveness, vector, engineVersion: TTECH_NATIVE_ENGINE_VERSION };
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.includes(",") ? value.split(",").pop() || "" : value;
  const binary = atob(normalized.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
