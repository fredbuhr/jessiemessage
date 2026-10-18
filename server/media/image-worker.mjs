import { createHash } from "node:crypto";
import sharp from "sharp";
import { imageFormat, MAX_IMAGE_INPUT_BYTES } from "./image.mjs";

sharp.cache(false);
sharp.concurrency(1);
// Only buffer loaders for the three supported raster formats are available.
// Filesystem, URL, SVG, PDF and all other foreign loaders remain blocked.
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({ operation: ["VipsForeignLoadJpegBuffer", "VipsForeignLoadPngBuffer", "VipsForeignLoadWebpBuffer"] });

function pngAnimated(bytes) {
  // APNG can be presented by decoders as one page. Inspect the complete chunk
  // stream as well as metadata; never accept a hidden animation's first frame.
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor);
    if (length > bytes.length - cursor - 12) return true;
    const kind = bytes.toString("ascii", cursor + 4, cursor + 8);
    if (kind === "acTL" || kind === "fcTL" || kind === "fdAT") return true;
    cursor += length + 12;
    if (kind === "IEND") return false;
  }
  return true;
}

function webpAnimated(bytes) {
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(cursor + 4);
    if (length > bytes.length - cursor - 8) return true;
    const kind = bytes.toString("ascii", cursor, cursor + 4);
    if (kind === "ANIM" || kind === "ANMF" || (kind === "VP8X" && length >= 1 && (bytes[cursor + 8] & 0x02) !== 0)) return true;
    cursor += 8 + length + (length % 2);
  }
  return cursor !== bytes.length;
}

let accepted = false;
process.once("message", async (request) => {
  if (accepted) return;
  accepted = true;
  let bytes = request?.bytes;
  let full;
  let thumbnail;
  let failure = "MEDIA_FORMAT";
  try {
    const format = imageFormat(bytes);
    if ((format === "png" && pngAnimated(bytes)) || (format === "webp" && webpAnimated(bytes))) throw new Error();
    const settings = { failOn: "warning", limitInputPixels: 16_000_000, sequentialRead: true, animated: false };
    // metadata() reads headers only. Inspect dimensions before the separately
    // pixel-bounded decode so a large photo gets a useful, sanitized error.
    const metadata = await sharp(bytes, { ...settings, limitInputPixels: false }).metadata();
    if (metadata.format !== format || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1 || (metadata.pages ?? 1) !== 1
      || (metadata.pageHeight !== undefined && metadata.pageHeight !== metadata.height)) throw new Error();
    if (metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > 16_000_000) {
      failure = "MEDIA_DIMENSIONS"; throw new Error();
    }
    failure = "MEDIA_UNAVAILABLE";
    const normalized = await sharp(bytes, settings).rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 245, g: 238, b: 242 } })
      .toColourspace("srgb").jpeg({ quality: 85, progressive: false }).toBuffer({ resolveWithObject: true });
    full = normalized.data;
    const small = await sharp(full, settings)
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: false }).toBuffer({ resolveWithObject: true });
    thumbnail = small.data;
    if (full.length > MAX_IMAGE_INPUT_BYTES || thumbnail.length > 512 * 1024) throw new Error();
    const result = {
      full, thumbnail, width: normalized.info.width, height: normalized.info.height,
      thumbnailWidth: small.info.width, thumbnailHeight: small.info.height,
      digest: createHash("sha256").update(full).digest(),
    };
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    const code = error?.code === "MEDIA_INPUT" ? "MEDIA_INPUT" : failure;
    process.send?.({ ok: false, code }, () => process.exit(0));
  } finally {
    // send() serializes the buffers synchronously; the child is killed by its
    // parent after the response and never retains original input between jobs.
    bytes?.fill?.(0);
  }
});

process.once("disconnect", () => process.exit(0));
