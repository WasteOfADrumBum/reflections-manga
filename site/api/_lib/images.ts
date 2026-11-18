import sharp from "sharp";
import { sha256 } from "./content/prompt-parser.js";

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  bytes: number;
  sha256: string;
}

export async function inspectImage(data: Buffer): Promise<ImageInfo> {
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height || !meta.format) throw new Error("Unreadable image");
  return { width: meta.width, height: meta.height, format: meta.format, bytes: data.byteLength, sha256: sha256(data) };
}

/**
 * Prepares a reference image for upload: re-encodes PNG, bounded to 2048 px on
 * the long side, metadata stripped. Never upscales.
 */
export async function prepareReference(data: Buffer): Promise<Buffer> {
  return sharp(data).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Aspect-ratio-safe normalisation to the 1024x1536 target. The requested size is
 * native for the configured model, so this normally does nothing. If a model
 * ever returns another 2:3 size it is resized uniformly; any other ratio is
 * letterboxed on white (matching gutters) rather than stretched.
 */
export async function normalizeToTarget(data: Buffer, width = 1024, height = 1536): Promise<{ data: Buffer; changed: boolean; note: string | null }> {
  const meta = await sharp(data).metadata();
  if (meta.width === width && meta.height === height) return { data, changed: false, note: null };
  const ratio = (meta.width ?? 1) / (meta.height ?? 1);
  const target = width / height;
  const fit = Math.abs(ratio - target) < 0.01 ? "fill" : "contain";
  const out = await sharp(data).resize({ width, height, fit, background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
  return {
    data: out,
    changed: true,
    note: fit === "fill" ? `Uniformly resized ${meta.width}x${meta.height} to ${width}x${height}.` : `Letterboxed ${meta.width}x${meta.height} onto ${width}x${height} without stretching.`,
  };
}

/** Public reader format: WebP at the existing 1024x1536 size. */
export async function toReaderWebp(data: Buffer): Promise<Buffer> {
  return sharp(data).webp({ quality: 88, effort: 5 }).toBuffer();
}

export async function thumbnail(data: Buffer, width = 360): Promise<Buffer> {
  return sharp(data).resize({ width, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
}

/** Validates an uploaded reference image. Rejects anything sharp cannot decode as a raster. */
export async function validateUpload(data: Buffer, maxBytes = 15 * 1024 * 1024): Promise<ImageInfo> {
  if (data.byteLength > maxBytes) throw new Error(`Image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const head = data.subarray(0, 12);
  const isPng = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const isWebp = head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isPng && !isJpeg && !isWebp) throw new Error("Only PNG, JPEG or WebP images are accepted.");
  const info = await inspectImage(data);
  if (info.width < 256 || info.height < 256) throw new Error("Image is too small to use as a reference.");
  if (info.width * info.height > 40_000_000) throw new Error("Image has too many pixels.");
  return info;
}
