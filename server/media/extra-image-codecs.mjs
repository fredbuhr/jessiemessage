import { readFile } from "node:fs/promises";

const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;
const MAX_TARGET_SIDE = 2048;
const MAX_RAW_PREVIEW_BYTES = 16 * 1024 * 1024;
const RAW_HINTS = new Set(["dng", "nef", "arw", "cr2", "cr3", "raf", "rw2", "orf", "pef", "srw"]);
const TIFF_HINTS = new Set(["dng", "nef", "arw", "cr2", "pef", "srw"]);
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
const TIFF_HEADERS = new Set(["49492a00", "4d4d002a", "49492b00", "4d4d002b"]);
const JXL_CONTAINER = Buffer.from([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 13, 10, 0x87, 10]);
const fail = code => { throw Object.assign(new Error("Photo conversion failed."), { code }); };

// This policy is installed before any untrusted bytes reach ping or read.
// HEIC/AVIF are deliberately unavailable in this ImageMagick distribution:
// their separate decoders must not enter its older bundled libheif at all.
const MAGICK_POLICY = `<?xml version="1.0"?><policymap>
  <policy domain="delegate" rights="none" pattern="*"/>
  <policy domain="filter" rights="none" pattern="*"/>
  <policy domain="module" rights="none" pattern="*"/>
  <policy domain="module" rights="read|write" pattern="{BMP,JXL,DNG}"/>
  <policy domain="coder" rights="none" pattern="*"/>
  <policy domain="coder" rights="read" pattern="{BMP,BMP2,BMP3,JXL,DNG}"/>
  <policy domain="coder" rights="none" pattern="{HEIC,HEIF,AVIF,SVG,MSVG,MVG,MSL,URL,HTTP,HTTPS,FTP,FILE,PDF,PS,EPS}"/>
  <policy domain="path" rights="none" pattern="@*"/>
  <policy domain="path" rights="none" pattern="|*"/>
</policymap>`;

function brands(bytes) {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return [];
  const size = bytes.readUInt32BE(0);
  if (size < 16 || size > bytes.length || size > 4096 || size % 4 !== 0) return [];
  const result = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < size; offset += 4) result.push(bytes.toString("ascii", offset, offset + 4));
  return result;
}

// A short extension hint only selects among compatible byte families. It
// never supplies a filename/path, and never overrides JPEG/PNG/etc signatures.
export function detectExtraImageFormat(bytes, { hint = null } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_INPUT_BYTES) return null;
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const dib = bytes.readUInt32LE(14);
    if ([12, 16, 40, 52, 56, 64, 108, 124].includes(dib)) return "bmp";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a
    || bytes.length >= 12 && bytes.subarray(0, 12).equals(JXL_CONTAINER)) return "jxl";
  const fileBrands = brands(bytes), avif = fileBrands.some(value => value === "avif" || value === "avis");
  // mif1/msf1 are legitimate compatible AVIF brands. Explicit HEVC brands
  // mixed with AVIF are not routed to either of this module's readers.
  if (avif && !fileBrands.some(value => HEIF_BRANDS.has(value) && !["mif1", "msf1"].includes(value))) return "avif";
  if (!RAW_HINTS.has(hint)) return null;
  const header = bytes.subarray(0, 4).toString("hex");
  if (TIFF_HINTS.has(hint) && TIFF_HEADERS.has(header)) return "raw";
  if (hint === "orf" && ["4949524f", "49495352", "4d4d4f52"].includes(header)) return "raw";
  if (hint === "rw2" && header === "49495500") return "raw";
  if (hint === "raf" && bytes.length >= 16 && bytes.toString("ascii", 0, 16) === "FUJIFILMCCD-RAW ") return "raw";
  if (hint === "cr3" && fileBrands.includes("crx ") && !avif && !fileBrands.some(value => HEIF_BRANDS.has(value))) return "raw";
  return null;
}

let magickTask;
function magick() {
  if (!magickTask) magickTask = (async () => {
    const api = await import("@imagemagick/magick-wasm");
    const { boundWasmMemory } = await import("./bounded-wasm.mjs");
    const original = await readFile(new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")));
    const wasm = boundWasmMemory(original, {
      expectedSha256: "54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c",
      expectedMinimumPages: 256, expectedMaximumPages: 65536, maximumPages: 8192,
      expectedBoundedSha256: "42b7e145fc333a4bc4f9440e7d631fa0e77de4721f7f09a75240ddae119e36ed",
    });
    api.ConfigurationFiles.default.policy.data = MAGICK_POLICY;
    await api.initializeImageMagick(wasm, api.ConfigurationFiles.default);
    return { api, nativeWidth: api.ResourceLimits.width, nativeHeight: api.ResourceLimits.height };
  })();
  return magickTask;
}

function limits(options) {
  const { hint = null, maxPixels = MAX_PIXELS, maxSide = null, targetSide = MAX_TARGET_SIDE } = options;
  if (hint !== null && !RAW_HINTS.has(hint)
    || !Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_PIXELS
    || maxSide !== null && (!Number.isSafeInteger(maxSide) || maxSide < 1)
    || !Number.isSafeInteger(targetSide) || targetSide < 1 || targetSide > MAX_TARGET_SIDE) fail("MEDIA_INPUT");
  return { hint, maxPixels, maxSide, targetSide };
}

function dimensions(width, height, options) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(width * height) || width * height > options.maxPixels
    || options.maxSide !== null && (width > options.maxSide || height > options.maxSide)) fail("MEDIA_DIMENSIONS");
}

async function rawPreview(bytes, orientation, options) {
  try {
    const { default: sharp } = await import("sharp");
    const settings = { failOn: "warning", limitInputPixels: Math.min(options.maxPixels, 16_000_000), sequentialRead: true, animated: false, pages: 1 };
    const metadata = await sharp(bytes, { ...settings, limitInputPixels: false }).metadata();
    if (metadata.format !== "jpeg") fail("MEDIA_FORMAT");
    dimensions(metadata.width, metadata.height, { ...options, maxPixels: Math.min(options.maxPixels, 16_000_000) });
    let pipeline = sharp(bytes, settings);
    if (metadata.orientation) pipeline = pipeline.rotate();
    else if (orientation === 2) pipeline = pipeline.flop();
    else if (orientation === 3) pipeline = pipeline.rotate(180);
    else if (orientation === 4) pipeline = pipeline.flip();
    else if (orientation === 5) pipeline = pipeline.flip().rotate(90);
    else if (orientation === 6) pipeline = pipeline.rotate(90);
    else if (orientation === 7) pipeline = pipeline.flop().rotate(90);
    else if (orientation === 8) pipeline = pipeline.rotate(270);
    const result = await pipeline.resize({ width: options.targetSide, height: options.targetSide, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (result.info.channels !== 4 || result.info.width > options.targetSide || result.info.height > options.targetSide
      || result.data.length !== result.info.width * result.info.height * 4) fail("MEDIA_UNAVAILABLE");
    return { data: result.data, width: result.info.width, height: result.info.height, channels: 4 };
  } catch (error) {
    if (["MEDIA_FORMAT", "MEDIA_DIMENSIONS", "MEDIA_UNAVAILABLE"].includes(error?.code)) throw error;
    fail("MEDIA_FORMAT");
  } finally { bytes.fill(0); }
}

async function decodeMagick(bytes, format, options) {
  let loaded;
  try { loaded = await magick(); } catch { fail("MEDIA_UNAVAILABLE"); }
  const { api, nativeWidth, nativeHeight } = loaded;
  const { ResourceLimits, ImageMagick, MagickImageInfo, MagickReadSettings, MagickFormat, ColorSpace } = api;
  ResourceLimits.memory = 256n * 1024n * 1024n;
  ResourceLimits.maxMemoryRequest = 256n * 1024n * 1024n;
  ResourceLimits.maxProfileSize = 16n * 1024n * 1024n;
  ResourceLimits.disk = 0n;
  ResourceLimits.area = BigInt(options.maxPixels);
  ResourceLimits.time = 20n;
  ResourceLimits.listLength = 2n;
  ResourceLimits.width = options.maxSide === null ? nativeWidth : BigInt(Math.min(options.maxSide, Number(nativeWidth)));
  ResourceLimits.height = options.maxSide === null ? nativeHeight : BigInt(Math.min(options.maxSide, Number(nativeHeight)));
  const forced = format === "bmp" ? MagickFormat.Bmp : format === "jxl" ? MagickFormat.Jxl : MagickFormat.Dng;
  const settings = new MagickReadSettings({ format: forced, frameIndex: 0, frameCount: 1 });
  try {
    // ping is forced too: it must never auto-select a forbidden HEIF coder.
    let info;
    if (format === "raw") {
      // LibRaw's full-resolution working buffers are not covered by the
      // ImageMagick pixel-cache limit. Extract its embedded JPEG during ping,
      // before any full raster is allocated, and leave JPEG decoding to Sharp.
      settings.setDefine(MagickFormat.Dng, "read-thumbnail", true);
      const image = api.MagickImage.create();
      let preview, orientation;
      try {
        image.ping(bytes, settings);
        info = { width: image.width, height: image.height };
        dimensions(info.width, info.height, options);
        // Camera crops may hide a larger sensor plane from width/height.
        // Validate the native raw-page dimensions as well, before full decode.
        if (image.page.width > 0 || image.page.height > 0) dimensions(image.page.width, image.page.height, options);
        orientation = image.orientation;
        const profile = image.getProfile("dng:thumbnail");
        if (profile?.data && profile.data.byteLength > 0 && profile.data.byteLength <= MAX_RAW_PREVIEW_BYTES
          && profile.data[0] === 255 && profile.data[1] === 216 && profile.data[2] === 255) preview = Buffer.from(profile.data);
      } finally { image.dispose(); }
      if (preview) return rawPreview(preview, orientation, options);
      settings.removeDefine(MagickFormat.Dng, "read-thumbnail");
    } else info = MagickImageInfo.create(bytes, settings);
    dimensions(info.width, info.height, options);
    return ImageMagick.read(bytes, settings, image => {
      dimensions(image.width, image.height, options);
      image.autoOrient();
      dimensions(image.width, image.height, options);
      const ratio = Math.min(1, options.targetSide / Math.max(image.width, image.height));
      if (ratio < 1) image.resize(Math.max(1, Math.floor(image.width * ratio)), Math.max(1, Math.floor(image.height * ratio)));
      image.colorSpace = ColorSpace.sRGB;
      const { width, height } = image;
      const data = image.getPixels(pixels => {
        const rgba = pixels.toByteArray(0, 0, width, height, "RGBA");
        if (!rgba || rgba.byteLength !== width * height * 4) fail("MEDIA_UNAVAILABLE");
        return Buffer.from(rgba);
      });
      return { data, width, height, channels: 4 };
    });
  } catch (error) {
    if (["MEDIA_INPUT", "MEDIA_FORMAT", "MEDIA_DIMENSIONS", "MEDIA_UNAVAILABLE"].includes(error?.code)) throw error;
    if (/WidthOrHeightExceedsLimit|ImagePixelLimitExceeded/.test(error?.message ?? "")) fail("MEDIA_DIMENSIONS");
    if (error instanceof WebAssembly.RuntimeError
      || /NotAuthorized|CacheResourcesExhausted|MemoryAllocationFailed|TimeLimitExceeded|out of memory|Aborted\(OOM\)/i.test(error?.message ?? "")) fail("MEDIA_UNAVAILABLE");
    fail("MEDIA_FORMAT");
  }
}

// No dependency import, WASM compilation or top-level await happens before
// the image child's IPC listener. The parent owns process/input/time limits;
// neither that isolation nor the cache settings imply a hard RSS ceiling.
export async function decodeExtraImage(bytes, format, options = {}) {
  const configured = limits(options);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_INPUT_BYTES) fail("MEDIA_INPUT");
  if (!["bmp", "jxl", "raw", "avif"].includes(format) || detectExtraImageFormat(bytes, configured) !== format) fail("MEDIA_FORMAT");
  if (format === "avif") fail("MEDIA_UNAVAILABLE"); // Separate AV1 decoder pending version-qualified selection.
  return decodeMagick(bytes, format, configured);
}
