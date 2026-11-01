import { createHash } from "node:crypto";
import sharp from "sharp";
import { imageFormat, MAX_IMAGE_INPUT_BYTES, MAX_PREPARATION_INPUT_BYTES, MAX_PREPARATION_OUTPUT_BYTES, MAX_PREPARATION_PIXELS } from "./image.mjs";
import { decodeHeicOriginal } from "./heic-original.mjs";

sharp.cache(false);
sharp.concurrency(1);
// Only explicit raster Buffer loaders are available. Original preparation
// additionally uses TIFF/GIF; assets keep their three-format input contract.
// Filesystem, URL, SVG, PDF and all other foreign loaders remain blocked.
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({ operation: ["VipsForeignLoadJpegBuffer", "VipsForeignLoadPngBuffer", "VipsForeignLoadWebpBuffer", "VipsForeignLoadTiffBuffer", "VipsForeignLoadNsgifBuffer"] });

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
async function originalInput(declaredBytes) {
  if (declaredBytes !== null && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 1 || declaredBytes > MAX_PREPARATION_INPUT_BYTES)) throw new Error();
  const target = declaredBytes === null ? null : Buffer.allocUnsafe(declaredBytes);
  const chunks = []; let received = 0;
  for await (const chunk of process.stdin) {
    if (!Buffer.isBuffer(chunk) || received + chunk.length > (declaredBytes ?? MAX_PREPARATION_INPUT_BYTES)) throw new Error();
    if (target) chunk.copy(target, received); else chunks.push(chunk);
    received += chunk.length;
  }
  if (received < 1 || declaredBytes !== null && received !== declaredBytes) throw new Error();
  return target ?? Buffer.concat(chunks, received);
}
process.once("message", async (request) => {
  if (accepted) return;
  accepted = true;
  let bytes = request?.bytes;
  let full;
  let thumbnail;
  let raster;
  let failure = "MEDIA_FORMAT";
  try {
    const preparation = request.preparation === true;
    if (preparation && request.stream === true) bytes = await originalInput(request.declaredBytes);
    const format = imageFormat(bytes, { preparation });
    if (!preparation && ((format === "png" && pngAnimated(bytes)) || (format === "webp" && webpAnimated(bytes)))) throw new Error();
    const maximumPixels = preparation ? MAX_PREPARATION_PIXELS : 16_000_000;
    const settings = { failOn: "warning", limitInputPixels: maximumPixels, sequentialRead: true, animated: false, pages: 1 };
    if (preparation && format === "heic") raster = await decodeHeicOriginal(bytes);
    if (raster && (!Buffer.isBuffer(raster.data) || ![3, 4].includes(raster.channels)
      || ![raster.width, raster.height].every(value => Number.isInteger(value) && value >= 1 && value <= 2048)
      || raster.data.length !== raster.width * raster.height * raster.channels)) { failure = "MEDIA_UNAVAILABLE"; throw new Error(); }
    const input = raster?.data ?? bytes;
    const inputSettings = raster ? { ...settings, raw: { width: raster.width, height: raster.height, channels: raster.channels } } : settings;
    // metadata() reads headers only. Inspect dimensions before the separately
    // pixel-bounded decode so a large photo gets a useful, sanitized error.
    const metadata = raster ? { format, width: raster.width, height: raster.height } : await sharp(bytes, { ...settings, limitInputPixels: false }).metadata();
    if (metadata.format !== format || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1 || !Number.isInteger(metadata.pages ?? 1) || (metadata.pages ?? 1) < 1
      || !preparation && ((metadata.pages ?? 1) !== 1 || metadata.pageHeight !== undefined && metadata.pageHeight !== metadata.height)) throw new Error();
    if ((!preparation && (metadata.width > 8192 || metadata.height > 8192)) || metadata.width * metadata.height > maximumPixels) {
      failure = "MEDIA_DIMENSIONS"; throw new Error();
    }
    failure = "MEDIA_UNAVAILABLE";
    const decode = source => sharp(source, inputSettings).rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 245, g: 238, b: 242 } })
      .toColourspace("srgb").jpeg({ quality: 85, progressive: false }).toBuffer({ resolveWithObject: true });
    let normalized;
    try {
      normalized = await decode(input);
    } catch (error) {
      // The pinned JPEG loader reports this exact input warning even when
      // metadata() can still read dimensions. Keep other native/output errors
      // and parent-observed crashes/timeouts classified as unavailable.
      if (format === "jpeg" && error?.message === "VipsJpeg: premature end of JPEG image") {
        failure = "MEDIA_FORMAT";
        if (preparation && !bytes.subarray(-2).equals(Buffer.from([255, 217]))) {
          // Repair only a missing end marker. The strict decoder still rejects
          // a missing scan/row or a damaged header; no tolerant pixel mode.
          failure = "MEDIA_UNAVAILABLE";
          try { normalized = await decode(Buffer.concat([bytes, Buffer.from([255, 217])])); }
          catch (retry) {
            if (["VipsJpeg: premature end of JPEG image", "VipsJpeg: Corrupt JPEG data: premature end of data segment"].includes(retry?.message)) failure = "MEDIA_FORMAT";
            throw retry;
          }
        } else throw error;
      } else throw error;
    }
    if (preparation && normalized.data.length > MAX_PREPARATION_OUTPUT_BYTES) {
      const first = normalized;
      for (let attempt = 1; attempt <= 4 && normalized.data.length > MAX_PREPARATION_OUTPUT_BYTES; attempt++) {
        normalized = await sharp(first.data, settings).resize({ width: Math.max(1, Math.floor(first.info.width * 0.8 ** attempt)),
          height: Math.max(1, Math.floor(first.info.height * 0.8 ** attempt)), fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: false }).toBuffer({ resolveWithObject: true });
      }
      if (normalized.data.length > MAX_PREPARATION_OUTPUT_BYTES) throw new Error();
    }
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
    const code = ["MEDIA_INPUT", "MEDIA_FORMAT", "MEDIA_DIMENSIONS", "MEDIA_UNAVAILABLE"].includes(error?.code) ? error.code : failure;
    process.send?.({ ok: false, code }, () => process.exit(0));
  } finally {
    // send() serializes the buffers synchronously; the child is killed by its
    // parent after the response and never retains original input between jobs.
    bytes?.fill?.(0);
    raster?.data?.fill?.(0);
  }
});

process.once("disconnect", () => process.exit(0));
